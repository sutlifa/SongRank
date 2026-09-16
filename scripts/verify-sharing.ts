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

await save(alice, "alice-public", "Alice's Beatles");
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

const feed = await q.listPublicTournaments();
check(
    feed.length === 1 && feed[0].id === "alice-public",
    `the browse feed must contain public rows only -- got ${feed.map((r) => r.id).join(", ")}`
);
console.log(`  private rankings invisible in every read path; feed has ${feed.length} row`);

// --- copying ---------------------------------------------------------------
console.log("\nCopying a list:");
check(
    (await q.copyTournament({ userId: bob, sourceId: "alice-private", newId: "nope", name: "x" })) === false,
    "copying a PRIVATE ranking must be refused"
);
check(
    (await q.copyTournament({ userId: bob, sourceId: "alice-public", newId: "bob-copy", name: "Copy" })) === true,
    "copying a public ranking must work"
);

const copy = (await q.getTournament(bob, "bob-copy"))!;
check(copy !== null, "the copy belongs to Bob");
check(copy.votes.length === 0, "the copy must NOT carry the original's votes");
check(copy.songs.length === songs.length, "the copy carries the whole song list");
check(copy.songs[0].id === "song-0", "the copy keeps song ids, which is what lets compare match exactly");
check((await q.getVisibility(bob, "bob-copy")) === "private", "a copy starts private whatever the original was");

const original = (await q.getTournament(alice, "alice-public"))!;
check(
    original.votes.length === 0 && original.name === "Alice's Beatles",
    "the ORIGINAL must be completely untouched by someone copying it"
);
console.log("  songs copied, votes left behind, original untouched, copy private");

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
await save(alice, "alice-public", "Alice's Beatles", playOut("alice-public", false));
await save(bob, "bob-copy", "Copy", playOut("bob-copy", true));

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
console.log("  one-way, idempotent, no self-follow, no phantom users");

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
