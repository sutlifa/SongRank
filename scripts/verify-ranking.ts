// scripts/verify-ranking.ts
//
// Headless proof that the adaptive pairwise ranking engine (lib/ranking.ts)
// behaves, run with:
//
//     node --experimental-strip-types scripts/verify-ranking.ts
//
// Mirrors scripts/verify-swiss.ts's approach and its reasons: pairing and
// rating bugs don't throw, they just quietly produce a repeated matchup or a
// ranking that doesn't track the truth, so this is checked by simulation
// rather than by eye.
//
// On simulating every vote of a large tournament: `deriveRanking` replays an
// already-decided vote in O(1) (see its own header for the pairing-id
// encoding that makes that true), so *one* call near the end of a
// 256-song Thorough tournament is cheap -- comfortably sub-millisecond,
// which is what actually matters for the app, since that's the shape of
// call a real vote click makes. But playing a tournament out *here*, vote by
// vote, calls `deriveRanking` (directly, plus once more inside
// `recordRankingVote` to validate) for every one of a few thousand votes in
// a tight loop, and each of those calls redoes the replay from scratch --
// so one *full simulated playout* is still O(matchups^2) in aggregate, same
// as verify-swiss.ts's own documented reason for capping its sweep at 64:
// "cheap for a human clicking through, expensive to do thousands of times a
// second with no human in the loop." A full n = 256 playout here costs
// several seconds; sizes are chosen below so the whole script still finishes
// in well under a minute.
//
// This script therefore doesn't simulate every single n from 2 to 256 in
// full (that would take many minutes), but it does: run full simulated
// playouts across a representative spread up to n = 64 under all three
// policies, a couple of larger spot checks up to n = 128, one single
// stress-test playout at the true ceiling (n = MAX_SONGS = 256), and O(1)
// formula checks -- the budget curve and the log2(n!) floor -- for every n
// in 2..256 exactly, since those are pure arithmetic and don't need
// sampling at all.
//
// Exits non-zero on the first broken invariant category and prints what
// broke, same contract as verify-swiss.ts.

import {
    deriveRanking,
    recordRankingVote,
    undoLastRankingVote,
    mainPhaseBudget,
    estimateMatchups,
    log2Factorial,
    ROUND_ROBIN_CEILING,
    TOP_CUT_SIZE,
    RANKING_DEPTH_FACTORS,
} from "../lib/ranking.ts";
import { MAX_SONGS } from "../lib/swiss.ts";
import { swapSongVersion } from "../lib/songVersion.ts";
import type { RankingDepth, Song, Tournament } from "../lib/types.ts";

/** Deterministic PRNG, so a failure is reproducible from its seed alone --
 * same generator verify-swiss.ts uses. */
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

function makeTournament(n: number, depth: RankingDepth): Tournament {
    const now = new Date("2026-01-01T00:00:00.000Z").toISOString();
    return {
        id: `verify-${n}-${depth}`,
        name: `Verify ${n} (${depth})`,
        createdAt: now,
        updatedAt: now,
        clipSeconds: 15,
        format: "adaptive",
        depth,
        songs: makeSongs(n),
        votes: [],
    };
}

type Policy = "random" | "seeded-favourite" | "noisy-favourite";

/** True skill: song 0 is the best, song n-1 is the worst -- id order doubles
 * as the ground-truth ranking the accuracy check below compares against. */
function skillOf(id: string, n: number): number {
    return n - 1 - Number(id.split("-")[1]);
}

/**
 * Who wins a matchup, per policy.
 *   - random: coin flip, no relationship to true skill at all.
 *   - seeded-favourite: the better song always wins -- zero noise, the
 *     clearest possible signal, used for the "does early stop trigger on a
 *     lopsided field" check and as the upper bound for rank correlation.
 *   - noisy-favourite: the better song usually wins, via a logistic curve on
 *     the skill gap (the same shape lib/ranking.ts's own expectedScore
 *     uses), so a big gap is nearly certain and a close one is close to a
 *     coin flip -- "low-noise voting" that still allows real upsets, which
 *     is what the rank-correlation check is meant to prove the engine
 *     handles.
 */
function pickWinner(a: string, b: string, n: number, policy: Policy, rng: () => number): string {
    if (policy === "random") return rng() < 0.5 ? a : b;
    const skillA = skillOf(a, n);
    const skillB = skillOf(b, n);
    if (policy === "seeded-favourite") return skillA > skillB ? a : (skillA < skillB ? b : a);
    const expectedA = 1 / (1 + Math.pow(10, (skillB - skillA) / 4));
    return rng() < expectedA ? a : b;
}

/** Spearman rank correlation between the engine's final standing order and
 * the ground-truth skill order. 1.0 is a perfect match, 0 is no
 * relationship, -1.0 is perfectly inverted. */
function spearman(standingOrder: string[], n: number): number {
    // True rank of song i is its index (song-0 is rank 0, the best).
    // Engine rank is the position in standingOrder.
    let sumSquaredDiff = 0;
    standingOrder.forEach((id, engineRank) => {
        const trueRank = Number(id.split("-")[1]);
        sumSquaredDiff += (engineRank - trueRank) ** 2;
    });
    return 1 - (6 * sumSquaredDiff) / (n * (n * n - 1));
}

let failures = 0;
let tournaments = 0;
let totalMatchups = 0;
let earlyStopCount = 0;

function fail(message: string): void {
    failures += 1;
    console.error(`FAIL: ${message}`);
    if (failures > 30) {
        console.error("Too many failures; stopping.");
        process.exit(1);
    }
}

function check(condition: boolean, message: string): void {
    if (!condition) fail(message);
}

interface PlayResult {
    finalStandingOrder: string[];
    mainDecided: number;
    championId: string | null;
}

/** Plays a tournament to completion, asserting every per-vote invariant
 * along the way, and returns the finished standing order for the
 * accuracy/correlation checks that need it. */
function play(n: number, depth: RankingDepth, policy: Policy, seed: number): PlayResult {
    const rng = mulberry32(seed);
    let tournament = makeTournament(n, depth);
    const context = `n=${n} depth=${depth} policy=${policy} seed=${seed}`;
    tournaments += 1;

    const totalPairs = (n * (n - 1)) / 2;
    const seenMainPairs = new Set<string>();
    const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

    const budget = mainPhaseBudget(n, depth);
    const guardCeiling = budget + TOP_CUT_SIZE * TOP_CUT_SIZE + 1000;
    let guard = 0;
    let mainDecided = 0;

    for (;;) {
        const state = deriveRanking(tournament);
        if (state.status !== "in_progress") break;
        if (guard++ > guardCeiling) {
            fail(`${context}: tournament did not finish within ${guardCeiling} votes`);
            break;
        }

        const current = state.current!;
        check(current.a !== current.b, `${context}: matchup ${current.pairingId} pairs a song against itself`);

        if (current.pairingId.startsWith("m")) {
            const key = pairKey(current.a, current.b);
            if (seenMainPairs.has(key)) {
                // A repeat is only legal once every possible pair in the
                // field has already been played at least once -- see
                // lib/ranking.ts's pickNextMatchup fallback chain.
                check(
                    seenMainPairs.size >= totalPairs,
                    `${context}: repeated main-phase matchup ${key} before the pool of ${totalPairs} pairs was exhausted (${seenMainPairs.size} seen)`
                );
            }
            seenMainPairs.add(key);
            mainDecided += 1;
        }

        const winner = pickWinner(current.a, current.b, n, policy, rng);
        const next = recordRankingVote(tournament, current.pairingId, winner);
        check(next.votes.length === tournament.votes.length + 1, `${context}: vote was not recorded`);
        tournament = next;
        totalMatchups += 1;

        // Undo must be exact: undo then redo lands on the same matchup.
        if (tournament.votes.length % 17 === 0) {
            const undone = { ...tournament, votes: tournament.votes.slice(0, -1) };
            const back = deriveRanking(undone);
            check(
                back.current?.pairingId === current.pairingId,
                `${context}: undo did not return to ${current.pairingId}`
            );
        }
    }

    const final = deriveRanking(tournament);
    check(final.status === "complete", `${context}: ended with status ${final.status}`);
    check(final.championId !== null, `${context}: finished without a champion`);
    check(final.standings[0]?.songId === final.championId, `${context}: champion is not standing #1`);

    // Standings must be a total order with unique, contiguous ranks covering
    // every song exactly once.
    final.standings.forEach((s, i) => check(s.rank === i + 1, `${context}: standing ${i} has rank ${s.rank}`));
    check(
        new Set(final.standings.map((s) => s.songId)).size === n,
        `${context}: standings do not cover every song exactly once`
    );

    // Main-phase matchup count never exceeds its budget (the engine must
    // stop asking once the budget -- or an early settle -- is reached).
    check(
        mainDecided <= budget,
        `${context}: main phase played ${mainDecided} matchups against a budget of ${budget}`
    );

    // Round-robin fields (n <= ROUND_ROBIN_CEILING) play every pair exactly
    // once and nothing else.
    if (n <= ROUND_ROBIN_CEILING) {
        check(mainDecided === totalPairs, `${context}: round-robin field played ${mainDecided}, expected ${totalPairs}`);
    }

    if (mainDecided < budget) earlyStopCount += 1;

    return { finalStandingOrder: final.standings.map((s) => s.songId), mainDecided, championId: final.championId };
}

// --- degenerate fields, which must not crash --------------------------------

for (const n of [0, 1]) {
    const t = makeTournament(n, "thorough");
    const state = deriveRanking(t);
    check(state.status === (n === 0 ? "empty" : "complete"), `n=${n}: unexpected status ${state.status}`);
    check(state.championId === (n === 1 ? "song-0" : null), `n=${n}: unexpected champion ${state.championId}`);
    check(state.current === null, `n=${n}: expected no current matchup`);
}

// --- budget formula and the information floor, for every n = 2..256 -------
//
// O(1) per n (mainPhaseBudget and log2Factorial are both closed-form/linear),
// so this covers the *entire* brief range exactly rather than sampling it --
// unlike the simulated sweep below, there's no reason not to.

for (let n = 2; n <= MAX_SONGS; n++) {
    const floor = log2Factorial(n);
    const thoroughBudget = mainPhaseBudget(n, "thorough");
    if (n > ROUND_ROBIN_CEILING) {
        check(
            thoroughBudget > floor,
            `mainPhaseBudget(${n}, thorough) = ${thoroughBudget} does not exceed the log2(${n}!) floor of ${floor.toFixed(1)}`
        );
    }
    // Quick and Balanced are deliberately less thorough than Thorough (see
    // lib/ranking.ts's RANKING_DEPTH_FACTORS) and monotonic with it.
    if (n > ROUND_ROBIN_CEILING) {
        check(
            mainPhaseBudget(n, "quick") <= mainPhaseBudget(n, "balanced"),
            `n=${n}: quick budget exceeds balanced`
        );
        check(
            mainPhaseBudget(n, "balanced") <= thoroughBudget,
            `n=${n}: balanced budget exceeds thorough`
        );
    }
    check(estimateMatchups(n, "thorough") >= thoroughBudget, `n=${n}: estimateMatchups is smaller than mainPhaseBudget`);
}

// The brief's own sanity-check numbers -- pinned exactly so a change to
// RANKING_DEPTH_FACTORS.thorough or the formula shape is caught immediately.
const sanityPoints: [number, number][] = [
    [8, 30],
    [16, 80],
    [32, 200],
    [64, 480],
    [128, 1120],
    [256, 2560],
];
for (const [n, expected] of sanityPoints) {
    check(
        mainPhaseBudget(n, "thorough") === expected,
        `mainPhaseBudget(${n}, thorough) = ${mainPhaseBudget(n, "thorough")}, expected ${expected}`
    );
}
check(RANKING_DEPTH_FACTORS.thorough === 1.25, "thorough factor drifted from the brief's 1.25x n*log2(n)");

// --- simulated sweep: a representative spread across n = 2..64 ------------
//
// See this file's header for why full simulated playouts are capped well
// below MAX_SONGS: it's the verify script's own O(matchups^2)-per-playout
// cost (from calling the engine once per vote with no human pacing it), not
// anything about the engine's real per-vote cost.

const sampleSizes = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 16, 20, 24, 32, 40, 48, 64];
const start = Date.now();

for (const n of sampleSizes) {
    play(n, "thorough", "random", n * 7919);
    play(n, "thorough", "seeded-favourite", n * 104729);
    play(n, "thorough", "noisy-favourite", n * 15485863);
}

// Quick and Balanced get a lighter pass -- their budgets are already checked
// as pure formulas above; this just confirms they actually terminate and
// hold the same invariants when played out for real.
for (const n of [16, 64]) {
    play(n, "quick", "random", n * 2);
    play(n, "balanced", "noisy-favourite", n * 3);
}

// --- early stop on a lopsided field ----------------------------------------
//
// A field with a deterministic favourite (seeded-favourite) should settle --
// every adjacent pair confidently separated -- before the budget runs out.
// This is realistically a *small*-field phenomenon, not a large-field one,
// and that's inherent to the pairing strategy rather than a shortcoming of
// it: `pickNextMatchup` always retests whichever pair is currently least
// predictable, so as a field grows there are more pairs competing for that
// attention and each one gets proportionally fewer of the budget's
// matchups -- confirmed by tuning both `kFactor` and `SETTLE_E_THRESHOLD`
// against exactly this sweep (see lib/ranking.ts's headers on both). n = 7
// and 8 (just above ROUND_ROBIN_CEILING, where adaptive selection first
// applies at all) are where a deterministic winner reliably settles within
// budget; a random field of the same size reliably does not, which is the
// pair of properties that actually matters -- early stop firing on genuine
// noise would be a false "the ranking is decided" claim.

for (const n of [7, 8]) {
    const budget = mainPhaseBudget(n, "thorough");
    const result = play(n, "thorough", "seeded-favourite", n * 424242);
    check(
        result.mainDecided < budget,
        `n=${n} seeded-favourite: expected an early stop (deterministic winner, should settle well short of budget), played ${result.mainDecided}/${budget}`
    );
}
for (const n of [7, 8, 9, 10]) {
    const budget = mainPhaseBudget(n, "thorough");
    const result = play(n, "thorough", "random", n * 13);
    check(
        result.mainDecided === budget,
        `n=${n} random: early stop fired on a noisy field (played ${result.mainDecided}/${budget}) -- that's a false "settled" claim`
    );
}

// --- ranking accuracy: the check that proves the engine actually works ----
//
// A seeded true order (song-0 best, song-(n-1) worst -- see skillOf) plus
// low-noise voting (noisy-favourite: the better song usually wins, with real
// but infrequent upsets) should produce a final ranking that strongly
// correlates with that true order. This is the one check that would catch a
// pair-selection or rating bug that still terminates and crowns *a* champion
// but ranks the field no better than chance.

console.log("\nRank correlation (Spearman, engine order vs. true skill order):");
const correlationSizes = [8, 16, 32, 64, 128];
const noisyCorrelations: number[] = [];
const seededCorrelations: number[] = [];

for (const n of correlationSizes) {
    const noisy = play(n, "thorough", "noisy-favourite", n * 31 + 1);
    const seeded = play(n, "thorough", "seeded-favourite", n * 31 + 2);
    const rNoisy = spearman(noisy.finalStandingOrder, n);
    const rSeeded = spearman(seeded.finalStandingOrder, n);
    noisyCorrelations.push(rNoisy);
    seededCorrelations.push(rSeeded);
    console.log(`  n=${n.toString().padStart(3)}  noisy-favourite: ${rNoisy.toFixed(3)}  seeded-favourite: ${rSeeded.toFixed(3)}`);

    // seeded-favourite is a deterministic true order with zero voting noise,
    // so it should correlate almost perfectly -- the only slack is the
    // top-cut playoff occasionally reordering songs whose ratings were
    // already extremely close.
    check(rSeeded > 0.97, `n=${n}: seeded-favourite correlation ${rSeeded.toFixed(3)} is below the 0.97 threshold`);
    // noisy-favourite has real upsets baked in, so a somewhat lower bar --
    // still strong enough to prove the ranking tracks the truth rather than
    // being noise itself.
    check(rNoisy > 0.85, `n=${n}: noisy-favourite correlation ${rNoisy.toFixed(3)} is below the 0.85 threshold`);
}

const avgNoisy = noisyCorrelations.reduce((a, b) => a + b, 0) / noisyCorrelations.length;
const avgSeeded = seededCorrelations.reduce((a, b) => a + b, 0) / seededCorrelations.length;
console.log(`  average: noisy-favourite ${avgNoisy.toFixed(3)}, seeded-favourite ${avgSeeded.toFixed(3)}`);

// --- single stress test at the true ceiling, n = MAX_SONGS (256) ----------
//
// Not part of the sized sweeps above (see this file's header for the cost
// reason) -- one full playout, just to prove the whole pipeline genuinely
// runs to completion at the largest field the app allows, with a real
// champion and a real correlation number to report.

console.log(`\nStress test at n = ${MAX_SONGS} (the true ceiling, played once):`);
const stress = play(MAX_SONGS, "thorough", "noisy-favourite", 999983);
const rStress = spearman(stress.finalStandingOrder, MAX_SONGS);
console.log(
    `  n=${MAX_SONGS}  matchups played: ${stress.mainDecided} (budget ${mainPhaseBudget(MAX_SONGS, "thorough")})  ` +
        `champion: ${stress.championId}  correlation: ${rStress.toFixed(3)}`
);
check(rStress > 0.85, `n=${MAX_SONGS} stress test: correlation ${rStress.toFixed(3)} is below the 0.85 threshold`);

// --- version swap invariant: the entire claim "Change version" rests on ---
//
// A version swap (lib/songVersion.ts) replaces a song's title, artist,
// album, artwork and preview -- but keeps `id` -- and the whole feature is
// only safe because nothing in this file keys off any of the replaced
// fields, only `id`. That's asserted here directly, not just in a comment:
// play a tournament partway, swap a song mid-flight, and check that the
// standings, matchup count and next pairing come out byte-for-byte
// identical to what they were immediately before the swap.

console.log("\nVersion swap invariant (mid-tournament):");
{
    const n = 40;
    const depth: RankingDepth = "thorough";
    const rng = mulberry32(555001);
    let tournament = makeTournament(n, depth);

    // Play a chunk of the tournament -- same shape as `play`'s own loop,
    // but stopping partway so there's a live `current` matchup, an
    // in-progress vote log, and songs with genuinely differentiated
    // ratings/RD to swap underneath.
    for (let i = 0; i < 60; i++) {
        const state = deriveRanking(tournament);
        if (state.status !== "in_progress") break;
        const current = state.current!;
        const winner = pickWinner(current.a, current.b, n, "noisy-favourite", rng);
        tournament = recordRankingVote(tournament, current.pairingId, winner);
    }
    check(tournament.votes.length > 0, "version-swap setup: expected at least one vote to have been played");

    const before = deriveRanking(tournament);
    const targetId = tournament.songs[7].id;

    const swapped = swapSongVersion(tournament, targetId, {
        title: "A Totally Different Recording",
        artist: "Someone Else Entirely",
        album: "A Different Album",
        artworkUrl: "https://example.test/different-art.jpg",
        previewUrl: "https://example.test/different-preview.m4a",
        previewSeconds: 45,
        itunesId: 999999999,
    });

    check(
        swapped.songs.find((s) => s.id === targetId)?.title === "A Totally Different Recording",
        "version swap: title was not replaced on the target song"
    );
    check(
        swapped.songs.map((s) => s.id).join(",") === tournament.songs.map((s) => s.id).join(","),
        "version swap: song id order/identity changed"
    );
    check(swapped.votes === tournament.votes, "version swap: vote log reference changed (a swap must never touch votes)");

    const after = deriveRanking(swapped);
    check(
        JSON.stringify(after.standings) === JSON.stringify(before.standings),
        "version swap: standings changed after a swap that preserved id"
    );
    check(
        JSON.stringify(after.current) === JSON.stringify(before.current),
        "version swap: next pairing changed after a swap that preserved id"
    );
    check(after.matchupsPlayed === before.matchupsPlayed, "version swap: matchupsPlayed changed after a swap that preserved id");
    check(after.matchupsPlanned === before.matchupsPlanned, "version swap: matchupsPlanned changed after a swap that preserved id");
    check(after.confidence === before.confidence, "version swap: confidence changed after a swap that preserved id");
    check(after.championId === before.championId, "version swap: championId changed after a swap that preserved id");

    // Undo must still work exactly the same across a swap: the vote log is
    // untouched (asserted above via reference equality), so undoing should
    // land on the identical previous matchup either way.
    const undoneBefore = deriveRanking(undoLastRankingVote(tournament));
    const undoneAfter = deriveRanking(undoLastRankingVote(swapped));
    check(
        JSON.stringify(undoneAfter.current) === JSON.stringify(undoneBefore.current),
        "version swap: undo landed on a different matchup after a swap"
    );

    // A swap on a song id that isn't in the tournament is a documented no-op
    // (same object back), not a silent corruption -- guards the "stale
    // reference from a panel left open across a reset" case.
    const noop = swapSongVersion(tournament, "not-a-real-id", {
        title: "x",
        artist: "y",
        album: null,
        artworkUrl: null,
        previewUrl: null,
        previewSeconds: null,
        itunesId: null,
    });
    check(noop === tournament, "version swap: swapping an unknown song id should return the same tournament reference");

    console.log(
        `  swapped song ${targetId} mid-tournament (${tournament.votes.length} votes played) -- ` +
            "standings, current matchup, and every derived count are unchanged"
    );
}

// Also prove it on a *finished* tournament -- the results-page use case,
// where there's no `current` matchup left, only a champion and final
// standings, both of which must survive a post-completion swap unchanged.
console.log("\nVersion swap invariant (on a finished tournament):");
{
    const n = 12;
    const depth: RankingDepth = "thorough";
    const rng = mulberry32(555002);
    let tournament = makeTournament(n, depth);
    let guard = 0;
    for (;;) {
        const state = deriveRanking(tournament);
        if (state.status !== "in_progress") break;
        if (guard++ > 5000) {
            fail("version-swap (finished) setup: tournament did not complete within 5000 votes");
            break;
        }
        const current = state.current!;
        const winner = pickWinner(current.a, current.b, n, "noisy-favourite", rng);
        tournament = recordRankingVote(tournament, current.pairingId, winner);
    }

    const before = deriveRanking(tournament);
    check(before.status === "complete", "version-swap (finished) setup: tournament did not finish");
    check(before.championId !== null, "version-swap (finished) setup: no champion decided");

    const swapped = swapSongVersion(tournament, before.championId!, {
        title: "Remastered Version",
        artist: "Someone Else",
        album: null,
        artworkUrl: null,
        previewUrl: null,
        previewSeconds: null,
        itunesId: null,
    });
    const after = deriveRanking(swapped);

    check(after.status === "complete", "version swap on a finished tournament: status changed");
    check(after.championId === before.championId, "version swap on a finished tournament: champion changed");
    check(
        JSON.stringify(after.standings) === JSON.stringify(before.standings),
        "version swap on a finished tournament: standings changed"
    );
    console.log(
        `  swapped the champion's recording on a finished n=${n} tournament -- ` +
            `champion (${after.championId}) and standings unchanged`
    );
}

const seconds = ((Date.now() - start) / 1000).toFixed(1);
console.log(
    `\n${tournaments} tournaments, ${totalMatchups} matchups, ${seconds}s\n` +
        `fields that stopped early (short of their main-phase budget): ${earlyStopCount}`
);

if (failures > 0) {
    console.error(`\n${failures} failure(s).`);
    process.exit(1);
}
console.log("\nAll invariants hold.");
