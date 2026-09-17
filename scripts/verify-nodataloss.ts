// scripts/verify-nodataloss.ts
//
// Proof that a save can never quietly discard someone's votes, run against a
// LOCAL database with:
//
//     DATABASE_URL=postgresql://...localhost... node --experimental-strip-types scripts/verify-nodataloss.ts
//
// This exists because the thing it checks actually happened. A browser holding
// an old copy of a ranking opened it, the autosave pushed that copy up, and a
// finished ranking of ~1900 votes became ~1600 -- no error, no warning, and no
// way back short of a database restore. The request was well-formed; every
// layer did what it was told. What was missing was anyone asking whether the
// save made the ranking SMALLER.
//
// Refuses to run against anything but localhost, same as verify-sharing.ts:
// it writes and deletes rows.

import { sql } from "../lib/db.ts";
import { saveTournament } from "../lib/queries.ts";
import type { Song, Vote } from "../lib/types.ts";

const url = process.env.DATABASE_URL ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
    console.error("Refusing to run: DATABASE_URL is not a local database.");
    process.exit(1);
}

let checks = 0;
const failures: string[] = [];
function check(label: string, actual: unknown, expected: unknown): void {
    checks += 1;
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) failures.push(`${label}\n    expected ${e}\n    actual   ${a}`);
}

const songs: Song[] = Array.from({ length: 4 }, (_, i) => ({
    id: `s${i}`,
    title: `Song ${i}`,
    artist: "Artist",
    album: null,
    artworkUrl: null,
    previewUrl: null,
    previewSeconds: null,
    previewNote: null,
    itunesId: null,
}));
const votes = (n: number): Vote[] =>
    Array.from({ length: n }, (_, i) => ({ pairingId: `m${i}`, winnerId: `s${i % 4}` }));

const [user] = await sql<{ id: number }[]>`
    INSERT INTO users (google_id, email, name)
    VALUES ('verify-nodataloss', 'nodataloss@example.com', 'Verify')
    ON CONFLICT (google_id) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
`;
const ID = "verify-nodataloss";
await sql`DELETE FROM tournaments WHERE id = ${ID}`;

const save = (n: number) =>
    saveTournament({
        userId: user.id,
        id: ID,
        name: "Guard test",
        clipSeconds: 30,
        format: "adaptive",
        depth: "quick",
        songs,
        votes: votes(n),
    });
const stored = async () => {
    const [row] = await sql<{ n: number }[]>`SELECT jsonb_array_length(votes) AS n FROM tournaments WHERE id = ${ID}`;
    return row?.n ?? -1;
};

// --- the ordinary life of a ranking --------------------------------------
check("first save creates the row", (await save(100)).inserted, true);
check("...and stores its votes", await stored(), 100);

check("moving forward is fine", (await save(900)).inserted, false);
check("...and the votes are there", await stored(), 900);

check("a big jump forward is fine", (await save(1900)).refused, undefined);
check("...stored", await stored(), 1900);

// --- undo still works -----------------------------------------------------
check("one undo is allowed", (await save(1899)).refused, undefined);
check("...stored", await stored(), 1899);
check("a few undos in a row are allowed", (await save(1895)).refused, undefined);
check("...stored", await stored(), 1895);

// --- the disaster ---------------------------------------------------------
// A stale device offering 1600 votes against the 1895 on record. This is the
// exact shape of the save that destroyed the real ranking.
const stale = await save(1600);
check("a stale save is refused", stale.refused !== undefined, true);
check("...and says what is stored", stale.refused?.storedVotes, 1895);
check("...and says what it offered", stale.refused?.incomingVotes, 1600);
check("...and NOTHING was written", await stored(), 1895);
check("...and it is not reported as an insert", stale.inserted, false);

// Re-offering the same stale copy must keep failing; there is no state in
// which repetition wears the guard down.
await save(1600);
await save(1600);
check("a stale save stays refused however often it repeats", await stored(), 1895);

// The stale device catching up is welcome the moment it really is ahead.
check("the same device is accepted once it is ahead", (await save(1896)).refused, undefined);
check("...stored", await stored(), 1896);

// --- the guard must not swallow the empty case ---------------------------
// A ranking legitimately starts at zero votes, so a FIRST save of zero is
// fine; it is only shrinking an existing one that is refused.
await sql`DELETE FROM tournaments WHERE id = ${ID}`;
check("a brand new ranking may have no votes", (await save(0)).inserted, true);
check("...stored", await stored(), 0);
check("and may then grow", (await save(50)).refused, undefined);

// --- someone else's ranking is still untouchable -------------------------
const [other] = await sql<{ id: number }[]>`
    INSERT INTO users (google_id, email, name)
    VALUES ('verify-nodataloss-2', 'nodataloss2@example.com', 'Other')
    ON CONFLICT (google_id) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
`;
const intruder = await saveTournament({
    userId: other.id,
    id: ID,
    name: "Stolen",
    clipSeconds: 30,
    format: "adaptive",
    depth: "quick",
    songs,
    votes: votes(9999),
});
check("another user cannot write this row", intruder.inserted, false);
check("...and it is not reported as a vote-loss refusal either", intruder.refused, undefined);
check("...and the row is unchanged", await stored(), 50);

await sql`DELETE FROM tournaments WHERE id = ${ID}`;
await sql`DELETE FROM users WHERE google_id IN ('verify-nodataloss', 'verify-nodataloss-2')`;
await sql.end();

if (failures.length > 0) {
    console.error(`\n${failures.length} of ${checks} checks FAILED:\n`);
    for (const f of failures) console.error(`  ${f}\n`);
    process.exit(1);
}
console.log(`\n${checks}/${checks} checks passed.`);
console.log("A save can move a ranking forward, or back by an undo. It cannot erase it.");
