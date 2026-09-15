// scripts/verify-swiss.ts
//
// Headless proof that the pairing engine behaves, run with:
//
//     node --experimental-strip-types scripts/verify-swiss.ts
//
// The Swiss engine is the part of this app most likely to be subtly wrong --
// pairing bugs don't throw, they just quietly produce a rematch in round 4 or
// a field with two unbeaten songs -- so it is checked by simulation rather
// than by eye. Every field size from 2 to 64 is played to completion under
// three different voting policies (a "handful of trials" per size), and every
// invariant below is asserted on every round of every one of those
// tournaments.
//
// Why 64 and not, say, 200: `derive()` is a full replay of the vote log on
// every single vote (see lib/swiss.ts's header comment for why that's the
// right tradeoff for the app itself -- a few hundred matchups is cheap for a
// human clicking through them). That makes one played-to-completion
// tournament roughly O(matchups^2), and sweeping every n from 2 up to some
// ceiling C costs roughly O(C^3.5) once you sum that across all the fields in
// the sweep. A sweep to 200 measured at several *minutes* here -- comfortably
// past "hangs" for anyone running this script expecting a quick check. 64
// still exercises every interesting shape (powers of two, one-off-from-a-
// power-of-two, small and mid-size odd fields, the float-down and playoff
// paths) in a few seconds, and the cheap O(1) checks below separately cover
// the true worst case (MAX_SONGS = 256) without ever playing it out.
//
// This is not a unit test framework and deliberately doesn't need one: it
// exits non-zero on the first broken invariant and prints what broke.

import { derive, plannedRounds, recordVote, MAX_SONGS } from "../lib/swiss.ts";
import type { Song, Tournament } from "../lib/types.ts";

/** Deterministic PRNG, so a failure is reproducible from its seed alone. */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function makeSongs(n: number): Song[] {
    return Array.from({ length: n }, (_, i) => ({
        id: `song-${i}`,
        title: `Track ${i}`,
        artist: `Artist ${i % 17}`,
        artworkUrl: null,
        previewUrl: null,
        previewSeconds: null,
        previewNote: null,
    }));
}

function makeTournament(n: number): Tournament {
    const now = new Date("2026-01-01T00:00:00.000Z").toISOString();
    return {
        id: `verify-${n}`,
        name: `Verify ${n}`,
        createdAt: now,
        updatedAt: now,
        clipSeconds: 15,
        songs: makeSongs(n),
        votes: [],
    };
}

type Policy = "random" | "seeded" | "upset";

/** Who wins a matchup, per policy. `seeded` makes lower seeds always win. */
function pickWinner(a: string, b: string, policy: Policy, rng: () => number): string {
    const seedOf = (id: string) => Number(id.split("-")[1]);
    if (policy === "seeded") return seedOf(a) < seedOf(b) ? a : b;
    if (policy === "upset") return seedOf(a) > seedOf(b) ? a : b;
    return rng() < 0.5 ? a : b;
}

let failures = 0;
let tournaments = 0;
let totalMatchups = 0;
let zeroUnbeatenFields = 0;
let rematchRounds = 0;
let doubleByeFields = 0;

function fail(message: string): void {
    failures += 1;
    console.error(`FAIL: ${message}`);
    if (failures > 20) {
        console.error("Too many failures; stopping.");
        process.exit(1);
    }
}

function check(condition: boolean, message: string): void {
    if (!condition) fail(message);
}

function play(n: number, policy: Policy, seed: number): void {
    const rng = mulberry32(seed);
    let tournament = makeTournament(n);
    const context = `n=${n} policy=${policy} seed=${seed}`;
    tournaments += 1;

    const expectedRounds = plannedRounds(n);
    check(
        expectedRounds === Math.max(1, Math.ceil(Math.log2(n))),
        `${context}: plannedRounds(${n}) = ${expectedRounds}, expected ${Math.max(1, Math.ceil(Math.log2(n)))}`
    );

    // Generous ceiling: the planned Swiss rounds plus the sudden-death rounds,
    // which at worst halve a pool of n.
    const voteCeiling = n * (expectedRounds + Math.ceil(Math.log2(n + 1)) + 2);
    let guard = 0;
    const seenPairings = new Set<string>();

    for (;;) {
        const state = derive(tournament);
        if (state.status !== "in_progress") break;
        if (guard++ > voteCeiling) {
            fail(`${context}: tournament did not finish within ${voteCeiling} votes`);
            return;
        }

        const current = state.current;
        if (!current) {
            fail(`${context}: status is in_progress but there is no current matchup`);
            return;
        }

        const { pairing } = current;
        check(pairing.b !== null, `${context}: current matchup ${pairing.id} is a bye`);
        check(
            current.numberInRound >= 1 && current.numberInRound <= current.matchupsInRound,
            `${context}: matchup number ${current.numberInRound} out of range 1..${current.matchupsInRound}`
        );

        // Per-round structure, checked on the round the user is sitting in.
        const round = current.round;
        const seenThisRound = new Set<string>();
        for (const p of round.pairings) {
            check(!seenThisRound.has(p.a), `${context}: ${p.a} appears twice in ${round.label}`);
            seenThisRound.add(p.a);
            if (p.b) {
                check(!seenThisRound.has(p.b), `${context}: ${p.b} appears twice in ${round.label}`);
                seenThisRound.add(p.b);
            }
            if (p.b) {
                const key = [p.a, p.b].sort().join("|");
                if (seenPairings.has(key)) {
                    // Only legal when the engine marked it as a forced rematch.
                    check(
                        p.isRematch,
                        `${context}: unmarked repeat pairing ${key} in ${round.label}`
                    );
                    rematchRounds += 1;
                }
            }
        }

        const winner = pickWinner(pairing.a, pairing.b as string, policy, rng);
        const next = recordVote(tournament, pairing.id, winner);
        check(next.votes.length === tournament.votes.length + 1, `${context}: vote was not recorded`);
        tournament = next;
        totalMatchups += 1;

        // Undo must be exact: undo then redo lands on the same matchup.
        if (tournament.votes.length % 13 === 0) {
            const undone = { ...tournament, votes: tournament.votes.slice(0, -1) };
            const back = derive(undone);
            check(
                back.current?.pairing.id === pairing.id,
                `${context}: undo did not return to ${pairing.id}`
            );
        }
    }

    const final = derive(tournament);
    check(final.status === "complete", `${context}: ended with status ${final.status}`);
    check(final.championId !== null, `${context}: finished without a champion`);

    // Rounds actually played: at least the planned Swiss rounds.
    const swissRounds = final.rounds.filter((r) => r.kind === "swiss").length;
    check(
        swissRounds === expectedRounds,
        `${context}: played ${swissRounds} Swiss rounds, expected ${expectedRounds}`
    );

    // Pairings: every song at most once per round, no duplicate matchups within
    // a round, at most one bye per song across the whole tournament.
    const byes = new Map<string, number>();
    const allPairings = new Set<string>();
    for (const round of final.rounds) {
        const seen = new Set<string>();
        const inRound = new Set<string>();
        for (const p of round.pairings) {
            check(!seen.has(p.a), `${context}: ${p.a} paired twice in ${round.label}`);
            seen.add(p.a);
            if (p.isBye) {
                byes.set(p.a, (byes.get(p.a) ?? 0) + 1);
                check(p.winner === p.a, `${context}: bye in ${round.label} was not auto-won`);
                continue;
            }
            check(p.b !== null, `${context}: non-bye pairing ${p.id} has no opponent`);
            check(!seen.has(p.b as string), `${context}: ${p.b} paired twice in ${round.label}`);
            seen.add(p.b as string);
            check(p.winner !== null, `${context}: ${p.id} finished undecided`);

            const key = [p.a, p.b].sort().join("|");
            check(!inRound.has(key), `${context}: duplicate matchup ${key} within ${round.label}`);
            inRound.add(key);
            if (allPairings.has(key)) {
                check(p.isRematch, `${context}: unmarked rematch ${key} in ${round.label}`);
            }
            allPairings.add(key);
        }
    }

    for (const [songId, count] of byes) {
        if (count > 1) {
            doubleByeFields += 1;
            fail(`${context}: ${songId} received ${count} byes`);
        }
    }

    // The headline guarantee: the tournament ends with a single song at the top
    // of the loss column, and it is the champion.
    const lossesOf = new Map(final.standings.map((s) => [s.songId, s.losses]));
    const minLosses = Math.min(...lossesOf.values());
    const atMin = [...lossesOf.entries()].filter(([, losses]) => losses === minLosses);
    check(
        atMin.length === 1,
        `${context}: ${atMin.length} songs tied on ${minLosses} losses at the end`
    );
    check(
        atMin[0]?.[0] === final.championId,
        `${context}: champion ${final.championId} is not the song with fewest losses (${atMin[0]?.[0]})`
    );

    const unbeaten = final.standings.filter((s) => s.losses === 0);
    check(unbeaten.length <= 1, `${context}: ${unbeaten.length} unbeaten songs at the end`);
    if (unbeaten.length === 1) {
        check(
            unbeaten[0].songId === final.championId,
            `${context}: unbeaten song is not the champion`
        );
    } else {
        // Legal but worth counting: the lone leader was paired down in the last
        // Swiss round and lost it, so nobody finished unbeaten and the playoff
        // ran between the one-loss songs instead. See fewestLossesPool().
        zeroUnbeatenFields += 1;
    }

    // Standings must be a total order with unique, contiguous ranks.
    final.standings.forEach((s, i) => {
        check(s.rank === i + 1, `${context}: standing ${i} has rank ${s.rank}`);
        check(s.omw >= 0.32 && s.omw <= 1.0001, `${context}: OMW% out of range: ${s.omw}`);
    });
    check(
        new Set(final.standings.map((s) => s.songId)).size === n,
        `${context}: standings do not cover every song exactly once`
    );
}

// --- degenerate fields, which must not crash --------------------------------

for (const n of [0, 1]) {
    const state = derive(makeTournament(n));
    check(state.status === (n === 0 ? "empty" : "complete"), `n=${n}: unexpected status ${state.status}`);
    check(state.rounds.length === 0, `n=${n}: expected 0 rounds, got ${state.rounds.length}`);
    check(
        state.championId === (n === 1 ? "song-0" : null),
        `n=${n}: unexpected champion ${state.championId}`
    );
    check(plannedRounds(n) === 0, `n=${n}: plannedRounds should be 0`);
}

// --- the main sweep, n = 2..64 -----------------------------------------------

const start = Date.now();
for (let n = 2; n <= 64; n++) {
    play(n, "random", n * 7919);
    play(n, "seeded", n * 104729);
    play(n, "upset", n * 15485863);
}

// --- MAX_SONGS is the worst case the app allows, but playing 256 songs to
// completion is exactly the cost this script exists to avoid paying on every
// run (see the header comment). These are the O(1) checks that don't require
// a simulated tournament: the round-count math the UI's up-front pitch
// (describePlan) and the pairing engine both depend on.
// -----------------------------------------------------------------------------

check(MAX_SONGS === 256, `MAX_SONGS changed to ${MAX_SONGS}; describePlan's doc comment cites 256`);
check(
    plannedRounds(MAX_SONGS) === 8,
    `plannedRounds(${MAX_SONGS}) = ${plannedRounds(MAX_SONGS)}, expected 8 (2^8 = 256)`
);
check(
    plannedRounds(MAX_SONGS) === Math.max(1, Math.ceil(Math.log2(MAX_SONGS))),
    `plannedRounds(${MAX_SONGS}) disagrees with the ceil(log2(n)) formula it's meant to implement`
);

const seconds = ((Date.now() - start) / 1000).toFixed(1);
console.log(
    `${tournaments} tournaments, ${totalMatchups} matchups, ${seconds}s\n` +
        `forced rematches: ${rematchRounds}\n` +
        `fields that ended with nobody unbeaten (playoff ran on one-loss songs): ${zeroUnbeatenFields}\n` +
        `fields where a song took two byes: ${doubleByeFields}`
);

if (failures > 0) {
    console.error(`\n${failures} failure(s).`);
    process.exit(1);
}
console.log("\nAll invariants hold.");
