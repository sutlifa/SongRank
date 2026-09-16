// scripts/verify-sharing.ts
//
// Proof that the sharing features keep private things private, run against a
// THROWAWAY local database:
//
//     node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/verify-sharing.ts
//
// Unlike the other verify scripts this one needs a real Postgres, because what
// it is checking IS the SQL. Every access rule in lib/queries.ts, lib/people.ts
// and lib/friends.ts is a WHERE clause; a missing one doesn't throw, doesn't
// fail a type check and doesn't look wrong on screen -- it just quietly hands a
// private ranking, or somebody's email address, to whoever asks. Those are
// exactly the bugs worth having an executable answer to.
//
// ## This script TRUNCATES the users table
//
// So it refuses to run against anything but a local database. The check below
// is deliberately strict and not overridable by a flag: an env var that says
// "yes really" is one shell-history recall away from being pointed at
// production, and the cost of getting this wrong is every user and every
// ranking they ever saved.
//
// Set up a throwaway instance, point DATABASE_URL at it, apply
// lib/db/schema.sql, and run.

import { sql } from "../lib/db.ts";
import * as q from "../lib/queries.ts";
import * as f from "../lib/friends.ts";
import * as people from "../lib/people.ts";
import * as users from "../lib/users.ts";
import * as notifications from "../lib/notifications.ts";
import { compareRankings, type CompareEntry } from "../lib/compare.ts";
import { profilePath } from "../lib/username.ts";
import { deriveTournament, recordVote } from "../lib/tournamentEngine.ts";
import { getCuratedStarter } from "../lib/starterLists.ts";
import type { Song, Tournament } from "../lib/types.ts";

// --- the safety gate -------------------------------------------------------
const url = process.env.DATABASE_URL ?? "";
if (!url) {
    console.error("DATABASE_URL is not set. Point it at a THROWAWAY local database and re-run.");
    process.exit(1);
}
const host = (() => {
    try {
        return new URL(url).hostname;
    } catch {
        return "";
    }
})();
if (!["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(host)) {
    console.error(
        `Refusing to run: DATABASE_URL points at "${host}", not a local database.\n` +
            "This script truncates the users table. Run it against a throwaway instance only."
    );
    process.exit(1);
}

let failures = 0;
function check(condition: boolean, message: string): void {
    if (!condition) {
        failures += 1;
        console.error(`FAIL: ${message}`);
    }
}

// --- fixtures --------------------------------------------------------------
await sql`TRUNCATE users RESTART IDENTITY CASCADE`;

async function makeUser(email: string, name: string): Promise<number> {
    const rows = await sql<{ id: number }[]>`
        INSERT INTO users (google_id, email, name, image)
        VALUES (${email}, ${email}, ${name}, null)
        RETURNING id
    `;
    return rows[0].id;
}

const alice = await makeUser("alice@example.com", "Alice Adams");
const bob = await makeUser("bob@example.com", "Bob Brown");
const carol = await makeUser("carol@example.com", "Carol Clark");

check((await users.setUsername(alice, "alice")) === "ok", "Alice can claim a handle");
check((await users.setUsername(bob, "bobby")) === "ok", "Bob can claim a different handle");
// Carol is left without one on purpose: "has no username" is an ordinary
// state that every read path has to keep working for, not an edge case.

const songs: Song[] = getCuratedStarter("beatles")!.songs.slice(0, 8).map((s, i) => ({
    id: `song-${i}`,
    title: s.title,
    artist: s.artist,
    artworkUrl: null,
    previewUrl: null,
    previewSeconds: null,
    previewNote: null,
}));

const save = (userId: number, id: string, name: string, votes: Tournament["votes"] = []) =>
    q.saveTournament({ userId, id, name, clipSeconds: 30, format: "adaptive", depth: "thorough", songs, votes });

/** Alice's list is deliberately saved on QUICK and on the legacy engine, so the
 * copy tests below can prove a copier inherits neither. */
const saveQuickSwiss = (userId: number, id: string, name: string) =>
    q.saveTournament({ userId, id, name, clipSeconds: 15, format: "swiss", depth: null, songs, votes: [] });

await saveQuickSwiss(alice, "alice-public", "Alice's Beatles");
await save(alice, "alice-private", "Alice's secret list");
await save(bob, "bob-private", "Bob's private thing");
await q.setTournamentVisibility(alice, "alice-public", "public");

// --- the access boundary ---------------------------------------------------
console.log("Access boundaries:");
check((await q.getPublicTournament("alice-public")) !== null, "a public ranking must be readable by anyone");
check((await q.getPublicTournament("alice-private")) === null, "a private ranking must NOT be readable as public");
check((await q.getPublicTournament("bob-private")) === null, "another user's private ranking must not leak");
check((await q.getComparableTournament(bob, "alice-private")) === null, "compare must not reach a stranger's private ranking");
check((await q.getComparableTournament(alice, "alice-private")) !== null, "you can always compare your own private ranking");
check((await q.getComparableTournament(null, "alice-public")) !== null, "a signed-out viewer can read a public ranking");
check((await q.setTournamentVisibility(bob, "alice-public", "private")) === false, "Bob must not be able to unpublish Alice's ranking");
check((await q.getPublicTournament("alice-public")) !== null, "...and it must still be public afterwards");

const feed = await q.listPublicTournaments(bob);
check(
    feed.length === 1 && feed[0].id === "alice-public",
    `the browse feed must contain public rows only -- got ${feed.map((r) => r.id).join(", ")}`
);

// Browse is for other people's rankings. Yours live on /history, and seeing
// them again filed under "everyone else" reads as a bug -- it is the one
// section they could never correctly belong to.
check(
    (await q.listPublicTournaments(alice)).every((r) => r.owner_id !== alice),
    "the browse feed must not contain the viewer's OWN public rankings"
);
// ...but the exclusion is per viewer, not a property of the row: it must still
// be there for everyone else, and for a signed-out visitor.
check(
    (await q.listPublicTournaments(bob)).some((r) => r.owner_id === alice),
    "Alice's public ranking must still appear for other signed-in viewers"
);
check(
    (await q.listPublicTournaments(null)).some((r) => r.owner_id === alice),
    "...and for a signed-out visitor, who excludes nobody"
);
console.log(
    `  private rankings invisible in every read path; feed has ${feed.length} row; ` +
        `own rankings excluded per viewer, not globally`
);

// --- copying -------------------------------------------------------------
//
// Copying is no longer a bespoke INSERT. /new?copy=<id> reads the source with
// getPublicTournament and the copier builds their own ranking through the
// ordinary save, so the guarantees now live in two places and both are checked
// here: the read cannot reach a ranking that was never shared, and the save
// records a source only when it is a real, public, undeleted ranking.
console.log("\nCopying a list:");
check(
    (await q.getPublicTournament("alice-private")) === null,
    "a PRIVATE ranking cannot be read as a template"
);
const template = (await q.getPublicTournament("alice-public"))!;
check(template !== null, "a public ranking can be read as a template");
check(template.songs.length === songs.length, "the template carries the whole song list");
check(template.songs[0].id === "song-0", "song ids come across, which is what lets compare match exactly");

/** What /new does with a template, minus the UI: the copier's own name, depth
 * and clip length, an empty vote log, and a credit back to the source. */
const saveCopy = (
    userId: number,
    id: string,
    name: string,
    depth: "quick" | "thorough",
    source: string | null
) =>
    q.saveTournament({
        userId,
        id,
        name,
        clipSeconds: 30,
        format: "adaptive",
        depth,
        songs: template.songs,
        votes: [],
        sourceTournamentId: source,
    });

await saveCopy(bob, "bob-copy", "Bob's own name for it", "thorough", "alice-public");
const copy = (await q.getTournament(bob, "bob-copy"))!;
check(copy !== null, "the copy belongs to Bob");
check(copy.votes.length === 0, "a copy starts with no votes");
check(copy.name === "Bob's own name for it", "the copier names it whatever they like");
check((await q.getVisibility(bob, "bob-copy")) === "private", "a copy starts private whatever the original was");

// Alice's source is saved as swiss / quick / 15s. None of it may come across.
check(copy.depth === "thorough", `the copier's own depth must be used, got ${copy.depth}`);
check(copy.format === "adaptive", `a copy runs on the current engine, got ${copy.format}`);
check(copy.clip_seconds === 30, `a copy uses today's clip length, got ${copy.clip_seconds}`);

await saveCopy(carol, "carol-copy", "Carol's copy", "quick", "alice-public");
check(
    (await q.getTournament(carol, "carol-copy"))!.depth === "quick",
    "two people copying the same list can pick different depths"
);

// The source credit is only ever recorded for a ranking that really is public.
check(
    (await q.listComparableTournaments(bob, "alice-public")).some((c) => c.id === "bob-copy"),
    "a copy is credited to its source, so the two can be compared"
);
await saveCopy(bob, "bob-bogus", "Bogus source", "thorough", "no-such-ranking");
check(
    (await q.getTournament(bob, "bob-bogus")) !== null,
    "an unknown source id must not fail the save -- it is only an attribution"
);
await saveCopy(bob, "bob-sneaky", "Private source", "thorough", "alice-private");
check(
    (await q.listComparableTournaments(bob, "alice-private")).every((c) => c.id !== "bob-sneaky"),
    "a PRIVATE ranking must not be recordable as a source"
);

// An autosave sends no source at all; the first save's credit must survive it.
await q.saveTournament({
    userId: bob,
    id: "bob-copy",
    name: "Bob's own name for it",
    clipSeconds: 30,
    format: "adaptive",
    depth: "thorough",
    songs: template.songs,
    votes: [],
});
check(
    (await q.listComparableTournaments(bob, "alice-public")).some((c) => c.id === "bob-copy"),
    "a later autosave must not wipe the source credit"
);

const original = (await q.getTournament(alice, "alice-public"))!;
check(
    original.votes.length === 0 && original.name === "Alice's Beatles",
    "the ORIGINAL must be completely untouched by someone copying it"
);
check(
    original.depth === null && original.format === "swiss" && original.clip_seconds === 15,
    "...including its own depth, format and clip length"
);
console.log(
    "  songs and ids come across; name, depth, format and clip length are the copier's; " +
        "source credited only when public, and survives autosave; original untouched"
);

// --- play both, then compare ----------------------------------------------
console.log("\nComparing:");
function playOut(id: string, preferLater: boolean): Tournament["votes"] {
    let t: Tournament = {
        id,
        name: "t",
        createdAt: "",
        updatedAt: "",
        clipSeconds: 30,
        format: "adaptive",
        depth: "thorough",
        songs,
        votes: [],
    };
    for (let i = 0; i < 500; i++) {
        const d = deriveTournament(t);
        if (d.status !== "in_progress") break;
        const c = d.current!;
        const ia = Number(c.a.split("-")[1]);
        const ib = Number(c.b.split("-")[1]);
        t = recordVote(t, c.pairingId, (preferLater ? ia > ib : ia < ib) ? c.a : c.b);
    }
    return t.votes;
}
await q.saveTournament({
    userId: alice,
    id: "alice-public",
    name: "Alice's Beatles",
    clipSeconds: 15,
    format: "adaptive",
    depth: "thorough",
    songs,
    votes: playOut("alice-public", false),
});
await q.saveTournament({
    userId: bob,
    id: "bob-copy",
    name: "Bob's own name for it",
    clipSeconds: 30,
    format: "adaptive",
    depth: "thorough",
    songs,
    votes: playOut("bob-copy", true),
});

function entries(row: q.TournamentRow): CompareEntry[] {
    const derived = deriveTournament({
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        clipSeconds: row.clip_seconds,
        format: row.format,
        depth: row.depth ?? undefined,
        songs: row.songs,
        votes: row.votes,
    });
    const byId = new Map(row.songs.map((s) => [s.id, s]));
    return derived.standings.flatMap((s) => {
        const song = byId.get(s.songId);
        return song ? [{ songId: song.id, title: song.title, artist: song.artist, rank: s.rank }] : [];
    });
}

const comparison = compareRankings(
    entries((await q.getComparableTournament(bob, "bob-copy"))!),
    entries((await q.getComparableTournament(bob, "alice-public"))!)
);
check(comparison.shared.length === songs.length, `two copies share every song, got ${comparison.shared.length}`);
check(comparison.onlyMine.length === 0 && comparison.onlyTheirs.length === 0, "a copy has no exclusive songs");
check(
    comparison.correlation !== null && comparison.correlation < -0.8,
    `opposite voting policies should correlate strongly negative, got ${comparison.correlation}`
);
check(
    (await q.listComparableTournaments(bob, "alice-public")).some((c) => c.id === "bob-copy"),
    "Bob's copy must be offered as comparable against the original"
);
console.log(`  ${comparison.shared.length} shared songs, correlation ${comparison.correlation?.toFixed(2)}`);

// --- friends ---------------------------------------------------------------
console.log("\nFriends:");
check((await f.addFriend(bob, alice)) === true, "Bob can follow Alice");
check((await f.addFriend(bob, alice)) === true, "following twice is idempotent, not an error");
check((await f.addFriend(bob, bob)) === false, "you cannot follow yourself");
check((await f.addFriend(bob, 999999)) === false, "following a non-existent user fails cleanly");
check((await f.isFriend(bob, alice)) === true, "the follow is visible to isFriend");
check((await f.isFriend(alice, bob)) === false, "following is ONE-WAY -- Alice does not follow Bob back");
check((await f.listFriends(bob)).length === 1, "Bob follows exactly one person");
check([...(await f.friendIds(bob))].join() === String(alice), "friendIds returns Alice");
check((await f.removeFriend(bob, alice)) === true, "unfollowing works");
check((await f.removeFriend(bob, alice)) === false, "unfollowing twice reports no change");
await f.addFriend(bob, alice);
await f.addFriend(carol, alice);

// Both directions, as a profile shows them.
const aliceCounts = await f.followCounts(alice);
check(aliceCounts.followers === 2, `Alice should have 2 followers, got ${aliceCounts.followers}`);
check(aliceCounts.following === 0, `Alice follows nobody, got ${aliceCounts.following}`);
const bobCounts = await f.followCounts(bob);
check(bobCounts.following === 1, `Bob follows one person, got ${bobCounts.following}`);
check(bobCounts.followers === 0, `nobody follows Bob, got ${bobCounts.followers}`);

const aliceFollowers = await f.listFollowers(alice);
check(aliceFollowers.length === 2, `Alice's follower list should have 2 rows, got ${aliceFollowers.length}`);
check(
    aliceFollowers.map((p) => p.id).sort().join() === [bob, carol].sort().join(),
    "Alice's followers should be exactly Bob and Carol"
);
check(
    !JSON.stringify(aliceFollowers).includes("@example.com"),
    "a follower list must not carry an email address either"
);
check((await f.listFollowers(bob)).length === 0, "Bob has no followers");
check((await f.listFriends(alice)).length === 0, "Alice follows nobody");
// The two directions must not be confused -- the classic way to get this
// wrong is joining on the same column twice.
check(
    (await f.listFriends(bob))[0]?.id === alice && (await f.listFollowers(alice))[0] !== undefined,
    "following and followers must read opposite columns of the same row"
);
await f.removeFriend(carol, alice);
console.log(
    `  one-way, idempotent, no self-follow, no phantom users; ` +
        `both directions counted separately (Alice: ${aliceCounts.followers} followers, ${aliceCounts.following} following)`
);

// --- the people directory --------------------------------------------------
console.log("\nPeople directory:");
const byName = await people.searchPeople("ali", bob);
check(byName.length === 1 && byName[0].id === alice, "a name substring finds Alice");
check(byName[0].username === "alice", "a result carries the handle");
check(
    !Object.keys(byName[0]).some((k) => k.toLowerCase().includes("email")),
    `a search result must carry no email field of any kind -- got keys: ${Object.keys(byName[0]).join(", ")}`
);
check(
    !JSON.stringify(byName).includes("@example.com"),
    "no email address may appear anywhere in a search result, masked or otherwise"
);
check(byName[0].publicRankings === 1, `Alice has one public ranking, got ${byName[0].publicRankings}`);

const byHandle = await people.searchPeople("alice", bob);
check(byHandle.length === 1 && byHandle[0].id === alice, "a username substring finds Alice");
check((await people.searchPeople("bobby", alice)).length === 1, "a handle that is not a name substring still matches");

check((await people.searchPeople("alice@example.com", bob)).length === 1, "a whole email address still finds someone");
check((await people.searchPeople("alice@", bob)).length === 0, "a PARTIAL address must not match -- no harvesting");
check((await people.searchPeople("@example.com", bob)).length === 0, "a bare domain must not enumerate users");
check((await people.searchPeople("a", bob)).length === 0, "a one-character query returns nothing");
check((await people.searchPeople("Bob", bob)).length === 0, "you are excluded from your own search results");

// Handles: uniqueness, case-insensitivity, and the /u/<handle> lookup.
check((await users.setUsername(bob, "ALICE")) === "taken", "a handle must be taken case-insensitively");
check((await users.getUsername(bob)) === "bobby", "...and the failed claim must not have changed Bob's handle");
check((await users.setUsername(bob, "bobby2")) === "ok", "Bob can change his own handle");
check((await users.setUsername(bob, "bobby")) === "ok", "...and change it back, now that the old one is free");

check((await people.getPersonByHandle("alice"))?.id === alice, "a profile resolves by handle");
check((await people.getPersonByHandle("ALICE"))?.id === alice, "handle lookup is case-insensitive");
check((await people.getPersonByHandle(String(alice)))?.id === alice, "a numeric id still resolves, so old links keep working");
check((await people.getPersonByHandle("nobody")) === null, "an unknown handle resolves to nothing");
check((await people.getPersonByHandle("")) === null, "an empty handle resolves to nothing");
check((await people.getPersonByHandle("0")) === null, "a zero id resolves to nothing");
check((await people.getPerson(carol))?.username === null, "someone without a handle is an ordinary, readable state");
check(
    profilePath({ id: 7, username: "sam" }) === "/u/sam" &&
        profilePath({ id: 7, username: null }) === "/u/7",
    "profilePath prefers the handle and falls back to the id"
);

const active = await people.listActivePeople(bob);
check(
    active.length === 1 && active[0].id === alice,
    `only people with something public are listed -- got ${active.map((p) => p.name).join(", ")}`
);
check((await people.getPerson(carol))!.publicRankings === 0, "Carol exists with nothing public");
check((await q.listPublicTournamentsByUser(alice)).length === 1, "a profile lists public rankings only");
console.log("  found by handle or name; no email in any payload; handles unique case-insensitively");

// --- soft delete -----------------------------------------------------------
//
// Deleting a ranking must make it vanish from every read path -- including the
// public ones, so a deleted ranking does not go on being visible to strangers
// just because its owner can still get it back -- while staying recoverable.
console.log("\nDeleting and restoring:");
{
    await q.setTournamentVisibility(alice, "alice-public", "public");
    check((await q.softDeleteTournament(alice, "alice-public")) === true, "deleting a ranking succeeds");
    check(
        (await q.softDeleteTournament(alice, "alice-public")) === false,
        "deleting it twice reports no change rather than erroring"
    );

    // Gone from everywhere it could be read.
    check((await q.getTournament(alice, "alice-public")) === null, "a deleted ranking is gone from your own history");
    check((await q.getPublicTournament("alice-public")) === null, "...and from the public read path");
    check(
        (await q.listPublicTournaments(bob)).every((r) => r.id !== "alice-public"),
        "...and from the browse feed"
    );
    check(
        (await q.listPublicTournamentsByUser(alice)).length === 0,
        "...and from its owner's profile"
    );
    check(
        (await q.getComparableTournament(bob, "alice-public")) === null,
        "...and from comparison, so an existing compare link stops resolving"
    );
    check(
        (await q.getVisibility(alice, "alice-public")) === null,
        "...and from the visibility lookup"
    );
    check(
        (await people.getPerson(alice))!.publicRankings === 0,
        "...and stops being counted on the people directory"
    );
    check(
        (await q.getPublicTournament("alice-public")) === null,
        "...and cannot be read as a template to copy"
    );

    // An autosave from a tab still open on it must not resurrect it.
    await save(alice, "alice-public", "Sneaky resurrection", []);
    check(
        (await q.getTournament(alice, "alice-public")) === null,
        "a background autosave must NOT bring a deleted ranking back"
    );

    // But it is still there, and comes back exactly as it was.
    const bin = await q.listDeletedTournaments(alice);
    check(bin.length === 1 && bin[0].id === "alice-public", `the deleted list should hold it, got ${bin.length}`);
    check(bin[0].deleted_at != null, "a deleted ranking records when it was deleted");
    check(bin[0].name === "Alice's Beatles", "the failed autosave must not even have renamed it");

    check((await q.restoreTournament(alice, "alice-public")) === true, "restoring succeeds");
    check((await q.restoreTournament(alice, "alice-public")) === false, "restoring twice reports no change");
    const back = await q.getTournament(alice, "alice-public");
    check(back !== null, "a restored ranking is readable again");
    check(back!.votes.length > 0, `a restored ranking keeps its votes, got ${back!.votes.length}`);
    check(
        (await q.getVisibility(alice, "alice-public")) === "public",
        "a ranking that was public before deletion is public again after restoring"
    );
    check((await q.listDeletedTournaments(alice)).length === 0, "and it leaves the deleted list");

    // Only "delete forever" actually destroys anything.
    await q.softDeleteTournament(alice, "alice-private");
    check((await q.purgeTournament(alice, "alice-private")) === true, "purging a deleted ranking succeeds");
    check((await q.restoreTournament(alice, "alice-private")) === false, "a purged ranking cannot be restored");
    check((await q.listDeletedTournaments(alice)).length === 0, "and it is gone from the deleted list too");

    // Scoping: neither stage may be aimed at someone else's ranking.
    check((await q.softDeleteTournament(bob, "alice-public")) === false, "you cannot delete someone else's ranking");
    check((await q.purgeTournament(bob, "alice-public")) === false, "nor purge it");
    check((await q.getTournament(alice, "alice-public")) !== null, "...and it is untouched after both attempts");
    console.log("  invisible everywhere while deleted, unresurrectable by autosave, restored intact, scoped to its owner");
}

// --- notifications ---------------------------------------------------------
//
// Two rules do the real work here and neither fails loudly if broken: nobody is
// ever told about their own actions, and nobody can be told the same thing
// twice. Without the second, following and unfollowing in a loop is an
// unbounded notification stream -- trivially abusable, and merely annoying when
// someone is just undecided.
console.log("\nNotifications:");
{
    await sql`TRUNCATE notifications`;

    // A follow notifies the person followed, not the follower.
    check((await notifications.notifyFollow(alice, bob)) === true, "a follow notifies the person followed");
    check((await notifications.unreadCount(alice)) === 1, "...and lands in their unread count");
    check((await notifications.unreadCount(bob)) === 0, "...and not in the follower's");

    // Once per person, forever.
    check((await notifications.notifyFollow(alice, bob)) === false, "the same follow is never announced twice");
    check((await notifications.unreadCount(alice)) === 1, "...and does not inflate the count");

    // Never about yourself.
    check((await notifications.notifyFollow(alice, alice)) === false, "nobody is notified about their own follow");

    // A copy names the ranking, and is also once-per-person-per-list.
    check(
        (await notifications.notifyCopy(alice, bob, "alice-public")) === true,
        "a copy notifies the list's owner"
    );
    check(
        (await notifications.notifyCopy(alice, bob, "alice-public")) === false,
        "...and is not repeated for the same list and person"
    );
    check((await notifications.notifyCopy(alice, alice, "alice-public")) === false, "copying your own list is silent");
    check(
        (await notifications.notifyCopy(alice, carol, "alice-public")) === true,
        "a DIFFERENT person copying the same list is news"
    );

    const listed = await notifications.listNotifications(alice);
    check(listed.length === 3, `Alice should have 3 notices, got ${listed.length}`);
    check(listed[0].created_at >= listed[listed.length - 1].created_at, "newest first");
    const copyRow = listed.find((n) => n.kind === "copy")!;
    check(copyRow.tournament_name === "Alice's Beatles", "a copy notice names the list");
    check(copyRow.actor_name !== null, "a notice names who did it");

    // Reading is idempotent and scoped.
    check((await notifications.markAllRead(alice)) === 3, "marking read clears everything unread");
    check((await notifications.unreadCount(alice)) === 0, "...and the count goes to zero");
    check((await notifications.markAllRead(alice)) === 0, "marking read again changes nothing");
    check(
        (await notifications.listNotifications(alice)).length === 3,
        "read notices are kept, not deleted"
    );

    // A notice never outlives the person or the ranking it is about.
    await notifications.notifyFollow(bob, carol);
    check((await notifications.unreadCount(bob)) === 1, "Bob has a notice from Carol");
    await users.deleteUser(carol);
    check(
        (await notifications.unreadCount(bob)) === 0,
        "a notice from a deleted account goes with them rather than naming nobody"
    );
    console.log("  addressed to the right person, never to yourself, never twice, and cleaned up on delete");
}

// --- deletion still cascades through the new tables ------------------------
console.log("\nAccount deletion:");
check((await users.deleteUser(alice)) === true, "deleting Alice succeeds");
check((await q.getPublicTournament("alice-public")) === null, "Alice's rankings go with her");
check((await f.listFriends(bob)).length === 0, "Bob's follow of a deleted account is cleaned up");
check((await q.getTournament(bob, "bob-copy")) !== null, "Bob's COPY survives Alice deleting her account");
console.log("  cascades clean up follows; a copy is its own ranking and survives");

await sql.end();

if (failures > 0) {
    console.error(`\n${failures} failure(s).`);
    process.exit(1);
}
console.log("\nAll sharing invariants hold.");
