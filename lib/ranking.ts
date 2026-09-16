// lib/ranking.ts
//
// The adaptive pairwise ranking engine. Pure functions over plain data --
// same discipline as lib/swiss.ts: no React, no Next imports, no I/O, no
// randomness, fully deterministic. And the same architecture: a tournament is
// `{ songs, votes }` (see lib/types.ts) and everything else -- ratings,
// standings, the current matchup, the champion -- is recomputed from that log
// on every call to `deriveRanking`. Undo is still `votes.slice(0, -1)`.
//
// Why this replaced Swiss: a correct total order of n items needs at least
// log2(n!) comparisons in the information-theoretic sense (that many
// yes/no answers are required to distinguish between n! possible orderings).
// For 256 songs that floor is ~1,684. Eight Swiss rounds on 256 songs is
// 8 * 128 = 1,024 comparisons -- already short of the floor before counting
// that Swiss also *wastes* comparisons re-pairing songs on identical records
// whose relative order a smarter pairing would already have settled. This
// engine instead tracks a rating (and an uncertainty) per song and always
// asks the question with the least predictable answer, which is the same
// thing as the question worth the most information.
//
// Rating model: Elo with an uncertainty-aware learning rate, not full
// Glicko-2. Glicko-2's volatility parameter and iterative rating-period
// convergence exist to handle players returning after a gap and rating
// deflation across a population over months of play -- neither applies here,
// where a whole tournament is one sitting and every song starts at the same
// prior. What Glicko contributes that plain Elo lacks -- a shrinking
// per-song uncertainty (RD) that widens or narrows how much a single result
// moves the rating -- is what actually matters for pair selection (see
// below), so that's the piece this keeps: a rating, a decaying RD, and a K
// factor derived from RD rather than fixed. That is the "plain Elo with a
// K that decays as RD shrinks" simplification flagged as acceptable in the
// brief.

import type { RankingDepth, Tournament, Vote } from "./types";

// ---------------------------------------------------------------------------
// Rating model
// ---------------------------------------------------------------------------

/** Every song's prior, before it has played anything. */
export const RATING_START = 1500;

/**
 * Starting uncertainty ("rating deviation"). Wide enough that a single
 * surprising early result can move a song's rating a lot -- there is nothing
 * else to go on yet -- and shrinks toward RD_FLOOR as the song accumulates
 * results (see `nextRd`).
 */
export const RD_START = 350;

/**
 * RD never fully collapses to zero: a floor keeps the K factor (below) from
 * decaying to nothing, which would make a song's rating permanently stuck
 * however surprising a later result is. 30 is small enough that a
 * well-established rating barely moves on an expected result, but not so
 * small that a genuine upset near the end of a tournament gets ignored.
 */
export const RD_FLOOR = 30;

interface RatingState {
    rating: number;
    rd: number;
    gamesPlayed: number;
}

function freshRating(): RatingState {
    return { rating: RATING_START, rd: RD_START, gamesPlayed: 0 };
}

/**
 * RD after `gamesPlayed` results, shrinking like a standard error: wide
 * uncertainty from few observations narrows roughly as 1/sqrt(games), with a
 * floor so it never fully vanishes (see RD_FLOOR). This is the "decays as
 * more games are played" half of the simplification described at the top of
 * this file -- Glicko-2 derives an equivalent shrinkage from a full Bayesian
 * update; this is the same shape without the machinery.
 */
function nextRd(gamesPlayed: number): number {
    return Math.max(RD_FLOOR, RD_START / Math.sqrt(1 + gamesPlayed));
}

/**
 * Learning rate for a single song, derived from its own RD rather than a
 * fixed constant: a song still near its starting uncertainty (high RD) should
 * move a lot on a result, and a song whose rating is already well-established
 * (low RD) should move only a little.
 *
 * K equal to RD itself, with no further scaling, is the simplification this
 * needs: it means "weight a result by exactly how uncertain we still are,"
 * which needs no separate constant to tune against RD's own scale. It is
 * self-clamping too -- RD_START and RD_FLOOR already bound K to [30, 350]
 * without a second pair of magic numbers repeating that bound.
 *
 * This was tuned empirically against RANKING_DEPTH_FACTORS' n * log2(n)
 * budgets, not chosen a priori: a much smaller K (K = RD / 8, an earlier
 * version of this function) never let adjacent standings separate enough
 * for `adjacentSettledFraction` to move off zero within any realistic
 * budget -- see
 * scripts/verify-ranking.ts's early-stop checks, which are what this value
 * has to keep passing.
 */
function kFactor(rd: number): number {
    return rd;
}

function expectedScore(ratingA: number, ratingB: number): number {
    return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Applies one decided result to both participants' rating state, in place.
 *
 * The actual-minus-expected term (`1 - expected` for the winner) is what
 * makes a surprising result move the rating more than an expected one: if
 * the winner was already a heavy favourite, `expected` is close to 1 and the
 * update is small; if the winner was a heavy underdog, `expected` is close
 * to 0 and the update is close to the full K factor.
 */
function applyResult(ratings: Map<string, RatingState>, winnerId: string, loserId: string): void {
    const winner = ratings.get(winnerId);
    const loser = ratings.get(loserId);
    if (!winner || !loser) return;

    const expectedWin = expectedScore(winner.rating, loser.rating);
    const kWinner = kFactor(winner.rd);
    const kLoser = kFactor(loser.rd);

    winner.rating += kWinner * (1 - expectedWin);
    loser.rating -= kLoser * (1 - expectedWin);

    winner.gamesPlayed += 1;
    loser.gamesPlayed += 1;
    winner.rd = nextRd(winner.gamesPlayed);
    loser.rd = nextRd(loser.gamesPlayed);
}

/**
 * Applies one *undecided* matchup -- the "Flip a coin" button, recorded as a
 * tie -- to both participants' rating state, in place.
 *
 * This is the same Elo update as `applyResult` with an actual score of 0.5 for
 * each side instead of 1/0, which is the standard and correct handling of a
 * draw: the pair still move toward each other, just far less than a decisive
 * result would move them, and the underdog gains while the favourite gives up
 * the same amount. Two songs the engine already rated equally do not move at
 * all, which is right -- confirming what it already believed teaches it
 * nothing about their order.
 *
 * Crucially this is NOT the same as skipping the matchup. Both songs still
 * bank a game, so their RD drops and the engine becomes more confident about
 * them -- because "a listener compared these two directly and could not
 * separate them" really is evidence about where they sit, and it is the whole
 * reason a tie is worth storing rather than discarding.
 */
function applyDraw(ratings: Map<string, RatingState>, aId: string, bId: string): void {
    const a = ratings.get(aId);
    const b = ratings.get(bId);
    if (!a || !b) return;

    const expectedA = expectedScore(a.rating, b.rating);
    const kA = kFactor(a.rd);
    const kB = kFactor(b.rd);

    a.rating += kA * (0.5 - expectedA);
    // (1 - expectedA) is B's expected score; the two updates are the same
    // formula, not a sign flip of one another, because K differs per song.
    b.rating += kB * (0.5 - (1 - expectedA));

    a.gamesPlayed += 1;
    b.gamesPlayed += 1;
    a.rd = nextRd(a.gamesPlayed);
    b.rd = nextRd(b.gamesPlayed);
}

// ---------------------------------------------------------------------------
// Budget: how many matchups a depth preset targets for a field of size n
// ---------------------------------------------------------------------------

/**
 * n <= this plays a full round robin instead of adaptive selection: exact
 * (every pair meets exactly once, so there is nothing left to be uncertain
 * about) and, at n(n-1)/2 <= 15 matchups, cheaper to just play out than to
 * spend cycles being clever about which pair to pick next.
 */
export const ROUND_ROBIN_CEILING = 6;

/**
 * Size of the top-cut playoff pool. Deliberately small and fixed rather than
 * scaled with n: its only job is to make the very top of the list decisive
 * (the eventual #1 has beaten every other contender for the position head to
 * head), not to re-rank a large chunk of the field a second time. At 4
 * songs a full round robin among them is 6 matchups -- "short" as promised,
 * regardless of how large the whole tournament is.
 */
export const TOP_CUT_SIZE = 4;

/** A top-cut playoff only adds information the main phase couldn't have
 * already settled by itself; below ROUND_ROBIN_CEILING every pair (including
 * every pair inside what would be the top cut) has already played directly,
 * so running it again would just repeat matchups for no new information. */
function shouldRunPlayoff(n: number): boolean {
    return n > ROUND_ROBIN_CEILING;
}

/**
 * Multiplier on `n * log2(n)` for each depth preset. Thorough's 1.25 is the
 * brief's own target and is the one value load-bearing enough to be checked
 * against the log2(n!) information floor in scripts/verify-ranking.ts --
 * Quick and Balanced are deliberately less thorough (that's the point of
 * offering them) and are not held to that floor themselves; a user who picks
 * Quick has explicitly traded provable completeness for a shorter session.
 */
export const RANKING_DEPTH_FACTORS: Record<RankingDepth, number> = {
    quick: 0.5,
    balanced: 0.85,
    thorough: 1.25,
};

/**
 * Target number of *main-phase* matchups (excludes the top-cut playoff,
 * which is added separately in `estimateMatchups` -- see there for why the
 * split matters) for a field of `n` at the given depth.
 */
export function mainPhaseBudget(n: number, depth: RankingDepth): number {
    if (n < 2) return 0;
    if (n <= ROUND_ROBIN_CEILING) return (n * (n - 1)) / 2;
    return Math.round(RANKING_DEPTH_FACTORS[depth] * n * Math.log2(n));
}

/**
 * The up-front estimate shown on /new before the user commits: main-phase
 * budget plus the fixed top-cut playoff cost, so the number promised matches
 * what will actually be asked for -- the same honesty lib/swiss.ts's
 * `describePlan` holds Swiss to.
 */
export function estimateMatchups(n: number, depth: RankingDepth): number {
    const main = mainPhaseBudget(n, depth);
    const playoff = shouldRunPlayoff(n) ? (TOP_CUT_SIZE * (TOP_CUT_SIZE - 1)) / 2 : 0;
    return main + playoff;
}

/** log2(n!), computed exactly (as a sum of logs, not Stirling's approximation)
 * since n only ever goes up to MAX_SONGS -- the information-theoretic floor
 * a correct total order of n items needs at least this many comparisons to
 * reach. Exported so scripts/verify-ranking.ts checks against the same
 * function this file's own header comment cites numbers from, rather than a
 * second copy that could quietly drift from it. */
export function log2Factorial(n: number): number {
    let total = 0;
    for (let k = 2; k <= n; k++) total += Math.log2(k);
    return total;
}

/** The up-front pitch shown on /new, mirroring lib/swiss.ts's `describePlan`. */
export function describeRankingPlan(n: number, depth: RankingDepth): string {
    if (n < 2) return n === 1 ? "1 song — add at least one more to start a tournament" : "No songs yet";
    if (n <= ROUND_ROBIN_CEILING) {
        const total = (n * (n - 1)) / 2;
        return `${n} songs → every pair plays once, ${total} matchup${total === 1 ? "" : "s"} total`;
    }
    const estimate = estimateMatchups(n, depth);
    const label = depth === "quick" ? "Quick" : depth === "balanced" ? "Balanced" : "Thorough";
    return `${n} songs → ${label}: about ${estimate.toLocaleString()} matchups, fewer if the ranking settles early`;
}

// ---------------------------------------------------------------------------
// Pair selection -- the heart of the engine
// ---------------------------------------------------------------------------

function pairKey(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * How many rating-sorted neighbours each song is checked against when
 * picking the next matchup, instead of scanning every one of the ~n^2/2
 * possible pairs on every single vote.
 *
 * Ratings are sorted first, so the smallest gaps -- the most informative
 * candidates, see `pairScore` -- are always between nearby indices in that
 * sorted order; a pair 100 places apart in the standings is essentially
 * never going to be the most informative choice, so there is no need to
 * ever compare it. sqrt(n) grows the window slowly enough that even at
 * n = 256 it stays at 32 rather than tracking n linearly, and the [8, 40]
 * clamp keeps both a tiny field (where n - 1 is already small) and a huge
 * one (where unclamped growth would start to matter) sane. At n = 256 this
 * checks at most 256 * 32 = 8,192 candidate pairs per pick -- a quarter of
 * the ~32,640 total pairs, and nowhere close to it in practice, since most
 * songs' windows are already full of not-yet-played candidates.
 */
function neighbourhoodWindow(n: number): number {
    const raw = Math.ceil(Math.sqrt(n)) * 2;
    return Math.max(1, Math.min(n - 1, Math.max(8, Math.min(raw, 40))));
}

/**
 * A single score standing in for the two criteria the brief asks for --
 * small rating gap *and* high combined uncertainty -- rather than sorting by
 * one and tie-breaking on the other. A two-stage sort needs an arbitrary
 * epsilon to decide when two gaps count as "tied" enough for the tiebreak to
 * kick in; dividing gap by combined RD folds both signals into one number
 * that a plain `min()` can compare directly, with no epsilon to tune: a
 * small gap lowers the score, and so does high uncertainty, in the same
 * units. Lower is more informative (closer to a coin flip); the floor of 1
 * on the denominator just guards against a division blowing up once RD has
 * fully decayed toward RD_FLOOR on both sides.
 */
function pairScore(ratings: Map<string, RatingState>, a: string, b: string): number {
    const ra = ratings.get(a)!;
    const rb = ratings.get(b)!;
    const gap = Math.abs(ra.rating - rb.rating);
    const combinedRd = ra.rd + rb.rd;
    return gap / Math.max(combinedRd, 1);
}

/** Full O(n^2) scan for the best-scoring pair, filtered by `played` when it's
 * supplied. This only ever runs as a fallback once the bounded window above
 * has nothing left to offer -- see `pickNextMatchup` -- which in practice
 * means only once the pool is close to (or fully) exhausted, when n is
 * usually small enough that O(n^2) is cheap anyway. */
function fullScanBest(
    ratings: Map<string, RatingState>,
    ids: string[],
    played: Set<string> | null
): [string, string] | null {
    let best: [string, string] | null = null;
    let bestScore = Infinity;
    for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
            const a = ids[i];
            const b = ids[j];
            if (played && played.has(pairKey(a, b))) continue;
            const score = pairScore(ratings, a, b);
            if (score < bestScore) {
                bestScore = score;
                best = [a, b];
            }
        }
    }
    return best;
}

/**
 * Picks the next matchup: whichever unplayed pair, among nearby ratings, has
 * the smallest gap relative to how uncertain both songs still are (see
 * `pairScore`) -- maximising expected information rather than exhaustively
 * computing it, which is the tractable stand-in the brief allows ("maximise
 * expected information" in the literal Bayesian sense would mean simulating
 * every possible outcome of every candidate pair and measuring the resulting
 * change in entropy across the whole field's ranking -- computable, but
 * millions of times more expensive per pick than this needs to be for a
 * ranking a human is clicking through in real time).
 *
 * `sortedIds` must already be sorted by rating (see `sortByRating`) -- the
 * windowed search below depends on it.
 */
function pickNextMatchup(
    sortedIds: string[],
    ratings: Map<string, RatingState>,
    played: Set<string>
): [string, string] {
    const window = neighbourhoodWindow(sortedIds.length);
    let best: [string, string] | null = null;
    let bestScore = Infinity;

    for (let i = 0; i < sortedIds.length; i++) {
        const a = sortedIds[i];
        for (let d = 1; d <= window && i + d < sortedIds.length; d++) {
            const b = sortedIds[i + d];
            if (played.has(pairKey(a, b))) continue;
            const score = pairScore(ratings, a, b);
            if (score < bestScore) {
                bestScore = score;
                best = [a, b];
            }
        }
    }
    if (best) return best;

    // The window came up empty -- every nearby pair has already played.
    // Widen to every remaining unplayed pair anywhere in the field before
    // giving up on "no repeats" (still O(n^2), but only reached once the
    // windowed search has nothing left, which in practice means the pool is
    // close to exhausted and n is usually small by then anyway).
    const anyUnplayed = fullScanBest(ratings, sortedIds, played);
    if (anyUnplayed) return anyUnplayed;

    // The pool really is exhausted: every pair in the field has played at
    // least once. Repeats are legal past this point -- see this file's
    // header and the brief's "avoid repeat pairings until the pool is
    // exhausted" -- so fall back to the same scoring with no `played` filter
    // at all, picking whichever pair is least settled right now.
    return fullScanBest(ratings, sortedIds, null)!; // n >= 2 guarantees a pair exists
}

/** Sorts song ids by rating, best first. Ties (identical ratings -- every
 * song before its first result, or two songs that have moved in lockstep)
 * keep their input order, because `Array.prototype.sort` has been a stable
 * sort since ES2019 and `ids` is always passed in the tournament's original
 * seed order -- so a tie resolves to seed order, deterministically, the same
 * final tiebreaker lib/swiss.ts uses. */
function sortByRating(
    ids: string[],
    ratings: Map<string, RatingState>,
    tiebreak?: {
        beat: Map<string, Set<string>>;
        wins: Map<string, number>;
        losses: Map<string, number>;
    }
): string[] {
    // Seed order alone (the stable-sort behaviour described above) keeps ties
    // deterministic, but deterministic is not the same as *right*: two songs
    // on an identical rating could be listed against a comparison the user
    // actually made. When the caller can supply the record -- which the final
    // standings can -- ties fall through a real ladder instead:
    //
    //   1. rating          the engine's whole-field estimate
    //   2. head to head    if these two were compared directly, that answer
    //                      wins; no aggregate should overrule a judgement the
    //                      user actually gave
    //   3. wins, then fewest losses
    //   4. lower RD        prefer the song the engine is more certain about
    //   5. seed            so equal songs can never reshuffle between renders
    //
    // `beat` maps each song to everything it has defeated, making step 2 a set
    // lookup rather than a rescan of the vote log.
    const seed = new Map(ids.map((id, i) => [id, i]));
    return [...ids].sort((a, b) => {
        const ra = ratings.get(a)!;
        const rb = ratings.get(b)!;
        if (rb.rating !== ra.rating) return rb.rating - ra.rating;

        if (tiebreak) {
            if (tiebreak.beat.get(a)?.has(b)) return -1;
            if (tiebreak.beat.get(b)?.has(a)) return 1;

            const wa = tiebreak.wins.get(a) ?? 0;
            const wb = tiebreak.wins.get(b) ?? 0;
            if (wa !== wb) return wb - wa;

            const la = tiebreak.losses.get(a) ?? 0;
            const lb = tiebreak.losses.get(b) ?? 0;
            if (la !== lb) return la - lb;

            if (ra.rd !== rb.rd) return ra.rd - rb.rd;
        }

        return seed.get(a)! - seed.get(b)!;
    });
}

/** Every unique pair among `ids`, in a fixed deterministic order. Used both
 * for the small-field full round robin and for the top-cut playoff, which
 * are the same "just play everyone against everyone" idea at two different
 * sizes. */
function roundRobinPairs(ids: string[]): [string, string][] {
    const pairs: [string, string][] = [];
    for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) pairs.push([ids[i], ids[j]]);
    }
    return pairs;
}

/**
 * A pair counts as "confidently separated" once the higher-rated song's
 * predicted win probability against its neighbour reaches this bar -- a
 * clear, better-than-coin-flip lean, not near-certainty (which this
 * algorithm's own pairing strategy makes nearly unreachable for *every*
 * adjacent pair at once: it always retests whichever pair is currently
 * least predictable, so the pairs left "adjacent" after sorting are, by
 * construction, the ones the system is least sure about -- see
 * `pairScore`). 0.62 was the empirically smallest bar (tuned in the same
 * pass as `kFactor`, against scripts/verify-ranking.ts) that a genuinely
 * random field never crosses by chance within its own budget, while a
 * clearly-decided small field reliably does.
 */
const SETTLE_E_THRESHOLD = 0.62;

/**
 * Fraction of ADJACENT pairs (in rating order) that are confidently
 * separated -- see `SETTLE_E_THRESHOLD`. 1.0 means no neighbour in the whole
 * standings is still in doubt, so another matchup is unlikely to change
 * anyone's relative order.
 *
 * This is the **early-stop condition only** (see `deriveRanking`). It used
 * to double as the "ranking is N% settled" number shown to the user, and was
 * badly wrong in that second job -- see `rankingConfidence` below, which
 * replaced it there.
 *
 * Deliberately scale-independent of RD: an earlier version compared the raw
 * rating gap to the pair's combined RD directly, which sounds more
 * "physical" but is the wrong scale here -- see `kFactor`'s header for why
 * RD and achievable gaps don't line up 1:1 in this specific pairing
 * strategy. Expected score is a monotonic function of the gap alone and
 * needs no separate uncertainty term to be meaningful.
 */
function adjacentSettledFraction(sortedIds: string[], ratings: Map<string, RatingState>): number {
    if (sortedIds.length < 2) return 1;
    let settled = 0;
    for (let i = 0; i < sortedIds.length - 1; i++) {
        const a = ratings.get(sortedIds[i])!;
        const b = ratings.get(sortedIds[i + 1])!;
        if (expectedScore(a.rating, b.rating) >= SETTLE_E_THRESHOLD) settled += 1;
    }
    return settled / (sortedIds.length - 1);
}

/**
 * How many standard errors of separation a pair needs before we claim to know
 * which of the two is better. At z = 1 the gap has to exceed the combined
 * uncertainty in the two ratings, which puts the odds of that ordering being
 * right at roughly 5 in 6 -- "a clear lean, not near-certainty", the same bar
 * `SETTLE_E_THRESHOLD` aims at, just expressed against the right scale.
 */
const CONFIDENT_Z = 1;

/**
 * The "ranking is N% settled" number shown while playing: the fraction of ALL
 * pairs in the field whose relative order the engine now knows confidently.
 *
 * Read it as "if you stopped right now, this much of the final answer is
 * already decided" -- which is the actual question someone staring at a
 * 1,900-matchup ranking wants answered.
 *
 * ## Why not just reuse `adjacentSettledFraction`
 *
 * It did, and on a large list the readout sat at 0% from the first matchup to
 * the last. The reason is a scale mismatch, not a coding error.
 * `SETTLE_E_THRESHOLD` of 0.62 is an *absolute* 85-point rating gap, but the
 * gap between neighbours shrinks as the field grows: 200 songs really do
 * spread over about 1,400 rating points, so the typical gap between one song
 * and the next is about 5. For all 199 of those neighbours to clear 85 points
 * the field would have to span 17,000. It cannot, so the fraction was pinned
 * at zero no matter how much work had been done -- true, useless, and
 * indistinguishable from a broken counter. Small fields hid it, because there
 * a handful of songs really can spread far enough apart, which is why the
 * early-stop tests never caught it.
 *
 * Two changes fix it, and both are needed:
 *
 *   - **All pairs, not just neighbours.** Knowing #1 beats #150 is real
 *     knowledge about the ranking. The adjacent-only view throws away almost
 *     everything the engine has established and asks only the single hardest
 *     question, n - 1 times over.
 *   - **Measured against uncertainty, not a constant.** Early on every rating
 *     is a wild guess with an RD of 350, and ratings scatter hundreds of
 *     points on the first result alone -- a fixed gap would read that noise as
 *     knowledge. Requiring the gap to beat the pair's combined standard error
 *     makes a spread earned over many matchups count and the same spread
 *     thrown up by two matchups not count, which is the distinction the number
 *     exists to draw.
 *
 * It follows that a large field finishes below 100%, and that is honest:
 * ~1,900 comparisons genuinely cannot pin down the order of 200 songs to the
 * last adjacent pair. The early stop keeps its own stricter rule, so nothing
 * about when a ranking ends changes -- only what the readout says while it
 * runs.
 *
 * O(n^2), which at the 256-song ceiling is ~33k comparisons of two floats --
 * far below the cost of the vote replay this runs at the end of, and done
 * once per derive rather than once per vote.
 */
function rankingConfidence(sortedIds: string[], ratings: Map<string, RatingState>): number {
    const n = sortedIds.length;
    if (n < 2) return 1;

    let confident = 0;
    for (let i = 0; i < n - 1; i++) {
        const a = ratings.get(sortedIds[i])!;
        for (let j = i + 1; j < n; j++) {
            const b = ratings.get(sortedIds[j])!;
            // sortedIds is rating-descending, so this gap is already >= 0 for
            // every j > i and needs no Math.abs.
            const standardError = Math.sqrt(a.rd * a.rd + b.rd * b.rd);
            if (a.rating - b.rating >= CONFIDENT_Z * standardError) confident += 1;
        }
    }
    return confident / ((n * (n - 1)) / 2);
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

export interface RankingCurrentMatchup {
    pairingId: string;
    a: string;
    b: string;
    /** 1-based position within whichever phase is active. */
    numberInPhase: number;
    /** Best current estimate of that phase's total -- see `matchupsPlanned`'s
     * own caveat below for why "estimate," not "fixed count," during the main
     * phase. */
    phaseTotal: number;
    /** True when this exact pair has already played once -- only possible
     * once `pickNextMatchup`'s no-repeats fallback has kicked in (main
     * phase), or when two top-cut songs already met during the main phase
     * before the playoff snapshot was taken. */
    isRematch: boolean;
}

export interface RankingStanding {
    songId: string;
    rank: number;
    rating: number;
    rd: number;
    wins: number;
    losses: number;
    /** Matchups answered with "Flip a coin" -- counted separately because a
     * tie is neither a win nor a loss, so folding it into either would make
     * the record on screen disagree with the matchups actually played. */
    ties: number;
}

export interface RankingDerived {
    status: "empty" | "in_progress" | "complete";
    standings: RankingStanding[];
    championId: string | null;
    current: RankingCurrentMatchup | null;
    /** Non-bye matchups decided so far, main phase plus playoff. */
    matchupsPlayed: number;
    /** Best current estimate of the total -- see the note on lib/swiss.ts's
     * equivalent field: this can jump upward in a single step exactly when
     * the top-cut playoff starts (its whole fixed cost lands in the
     * denominator at once), so a caller rendering this as a progress bar
     * needs to smooth that itself, the same as the Swiss engine's consumer
     * already does. */
    matchupsPlanned: number;
    /** True once the top-cut playoff has started. */
    inPlayoffs: boolean;
    /** Fraction of all pairs in the field whose relative order is known
     * confidently -- see `rankingConfidence`, which is also where the
     * difference between this and the engine's early-stop rule is spelled
     * out. Null only for the n = 0/1 degenerate cases, where the concept
     * doesn't apply. */
    confidence: number | null;
}

function emptyDerived(): RankingDerived {
    return {
        status: "empty",
        standings: [],
        championId: null,
        current: null,
        matchupsPlayed: 0,
        matchupsPlanned: 0,
        inPlayoffs: false,
        confidence: null,
    };
}

function singleSongDerived(songId: string): RankingDerived {
    return {
        status: "complete",
        standings: [{ songId, rank: 1, rating: RATING_START, rd: RD_START, wins: 0, losses: 0, ties: 0 }],
        championId: songId,
        current: null,
        matchupsPlayed: 0,
        matchupsPlanned: 0,
        inPlayoffs: false,
        confidence: 1,
    };
}

/**
 * Encodes a main-phase adaptive matchup's own two participants directly into
 * its pairing id -- `m{index}:{songIdA}:{songIdB}` -- rather than leaving a
 * replayer to work out who played by re-running the picker. This is the
 * difference between replaying a decided vote in O(1) and in
 * O(n log n + n * window): see `deriveRanking`'s header for why that
 * difference is the whole ballgame at n = 256. `:` is safe as a delimiter
 * for the same reason `pairKey`'s `|` is: every song id in this app is
 * either a `crypto.randomUUID()` or a test fixture slug, never containing
 * either character.
 */
function encodeAdaptivePairingId(index: number, a: string, b: string): string {
    return `m${index}:${a}:${b}`;
}

function parseAdaptivePairingId(id: string): { index: number; a: string; b: string } | null {
    if (!id.startsWith("m") || !id.includes(":")) return null;
    const parts = id.slice(1).split(":");
    if (parts.length !== 3) return null;
    const index = Number(parts[0]);
    if (!Number.isInteger(index) || index < 0) return null;
    return { index, a: parts[1], b: parts[2] };
}

/**
 * Replays a tournament from its song list and vote log.
 *
 * Called on every render and after every vote (same contract as
 * lib/swiss.ts's `derive`); kept cheap for the same reason, but the
 * *shape* of "cheap" here is different from Swiss's. Swiss computes an
 * entire round's pairings once (an O(round-size) search) and then replays
 * every vote in that round for O(1) each; the adaptive engine has no
 * equivalent batching -- naively, *every single vote* changes the ratings
 * that determine the next pick, so recomputing "what would the engine have
 * picked here" for every already-decided historical vote would cost
 * O(n log n + n * window) *per vote*, and summed over a ~2,560-matchup
 * Thorough tournament at n = 256 that is tens of millions of operations on
 * every single derive call -- multiple seconds of UI-thread work on every
 * vote near the end of a large tournament, which was true of an earlier
 * version of this function.
 *
 * The fix is `encodeAdaptivePairingId`: a matchup's own two participants
 * travel with its pairing id, so a *historical* vote can be replayed by
 * trusting that encoding (parse, sanity-check, apply the rating update) in
 * O(1), without ever re-deriving what the picker would have chosen. The
 * expensive selection logic (`pickNextMatchup`, and the sort and
 * confidence check that gate the playoff transition) runs only *once* per
 * `deriveRanking` call, to work out `current` -- the one matchup that
 * genuinely doesn't exist in the log yet. That makes a full replay of k
 * already-decided votes O(k) plus one O(n log n + n * window) tail, not
 * O(k * (n log n + n * window)).
 *
 * One consequence worth being explicit about: trusting the log's own
 * `m`/`p` prefix (rather than independently re-deriving "was this actually
 * the moment the main phase should have ended") means a hand-edited vote
 * log could in principle claim an early or late playoff transition and
 * replay would accept it. This is the same tradeoff lib/swiss.ts's `derive`
 * already makes for a malformed log ("treated as if it ended" rather than
 * cryptographically verified) -- the data in question is one signed-in
 * user's own single-player save, not a shared or competitive record, so
 * the failure mode of a tampered save is "a slightly odd personal ranking,"
 * not a security issue.
 */
export function deriveRanking(tournament: Tournament): RankingDerived {
    const songs = tournament.songs;
    const n = songs.length;

    if (n === 0) return emptyDerived();
    if (n === 1) return singleSongDerived(songs[0].id);

    const depth: RankingDepth = tournament.depth ?? "thorough";
    const ids = songs.map((s) => s.id);
    const budget = mainPhaseBudget(n, depth);
    const useRoundRobin = n <= ROUND_ROBIN_CEILING;
    const mainSchedule = useRoundRobin ? roundRobinPairs(ids) : null;

    const ratings = new Map<string, RatingState>(ids.map((id) => [id, freshRating()]));
    const idSet = new Set(ids);
    const wins = new Map<string, number>(ids.map((id) => [id, 0]));
    const losses = new Map<string, number>(ids.map((id) => [id, 0]));
    // Everything each song has beaten, so the final ordering can break a tie on
    // a direct comparison the user actually made rather than on aggregates.
    const beat = new Map<string, Set<string>>(ids.map((id) => [id, new Set<string>()]));
    const ties = new Map<string, number>(ids.map((id) => [id, 0]));
    const played = new Set<string>();

    /**
     * Applies one answered matchup. `tie` is `Vote.tie` -- see its doc comment
     * in lib/types.ts: on a tie the nominal winner/loser split is an arbitrary
     * coin flip and must not reach anything that would act on it.
     *
     * So a tie: updates ratings as a draw, credits neither a win nor a loss,
     * and stays OUT of `beat` -- the head-to-head tiebreak exists to honour a
     * judgement the listener actually made, and on this matchup they told us
     * they had none. It does still land in `played`, because the pair really
     * were put in front of someone and re-asking a question already answered
     * "I can't tell" is the least informative matchup available.
     */
    function applyDecided(winnerId: string, loserId: string, tie = false): void {
        if (tie) {
            applyDraw(ratings, winnerId, loserId);
            ties.set(winnerId, (ties.get(winnerId) ?? 0) + 1);
            ties.set(loserId, (ties.get(loserId) ?? 0) + 1);
        } else {
            applyResult(ratings, winnerId, loserId);
            wins.set(winnerId, (wins.get(winnerId) ?? 0) + 1);
            losses.set(loserId, (losses.get(loserId) ?? 0) + 1);
            beat.get(winnerId)?.add(loserId);
        }
        played.add(pairKey(winnerId, loserId));
    }

    let phase: "main" | "playoff" | "done" = "main";
    let mainDecided = 0;
    let mainScheduleIndex = 0;
    let playoffSchedule: [string, string][] | null = null;
    let playoffIndex = 0;
    let playoffWins: Map<string, number> | null = null;
    let playoffBeat: Map<string, Set<string>> | null = null;
    let voteIndex = 0;

    // --- fast-forward through every already-decided vote, O(1) each -------
    while (voteIndex < tournament.votes.length) {
        const vote = tournament.votes[voteIndex];

        if (phase === "main" && useRoundRobin) {
            if (mainScheduleIndex >= mainSchedule!.length) break;
            const [sa, sb] = mainSchedule![mainScheduleIndex];
            if (vote.pairingId !== `m${mainScheduleIndex}` || (vote.winnerId !== sa && vote.winnerId !== sb)) break;
            applyDecided(vote.winnerId, vote.winnerId === sa ? sb : sa, vote.tie === true);
            mainScheduleIndex += 1;
            mainDecided += 1;
            voteIndex += 1;
            if (mainScheduleIndex >= mainSchedule!.length) phase = shouldRunPlayoff(n) ? "playoff" : "done";
            continue;
        }

        // The `startsWith("m")` guard matters: without it, a "p"-prefixed
        // vote (the playoff transition, handled below) would hit
        // `parseAdaptivePairingId` here first, fail to parse (it only
        // understands the "m..." shape), and `break` the whole fast-forward
        // before the transition check ever ran -- silently stranding replay
        // one step short of the playoff every single time.
        if (phase === "main" && !useRoundRobin && vote.pairingId.startsWith("m")) {
            const parsed = parseAdaptivePairingId(vote.pairingId);
            if (
                !parsed ||
                parsed.index !== mainDecided ||
                parsed.a === parsed.b ||
                !idSet.has(parsed.a) ||
                !idSet.has(parsed.b) ||
                (vote.winnerId !== parsed.a && vote.winnerId !== parsed.b)
            ) {
                break;
            }
            applyDecided(vote.winnerId, vote.winnerId === parsed.a ? parsed.b : parsed.a, vote.tie === true);
            mainDecided += 1;
            voteIndex += 1;
            continue;
        }

        // phase is "main" only above; a "p"-prefixed vote while still "main"
        // is exactly the playoff transition, computed here -- once, not
        // once per vote -- from whatever the ratings are at this exact point
        // in the log. See this function's header for why replay trusts the
        // log's own prefix to mark that transition rather than
        // independently re-deriving whether this was the "correct" moment.
        if (phase === "main") {
            if (!vote.pairingId.startsWith("p") || !shouldRunPlayoff(n)) break;
            const sorted = sortByRating(ids, ratings);
            const topCut = sorted.slice(0, TOP_CUT_SIZE);
            playoffSchedule = roundRobinPairs(topCut);
            playoffWins = new Map(topCut.map((id) => [id, 0]));
            playoffBeat = new Map(topCut.map((id) => [id, new Set<string>()]));
            phase = "playoff";
        }

        if (phase === "playoff") {
            if (playoffIndex >= playoffSchedule!.length) {
                phase = "done";
                break;
            }
            const [pa, pb] = playoffSchedule![playoffIndex];
            if (vote.pairingId !== `p${playoffIndex}` || (vote.winnerId !== pa && vote.winnerId !== pb)) break;
            const loserId = vote.winnerId === pa ? pb : pa;
            applyDecided(vote.winnerId, loserId, vote.tie === true);
            if (vote.tie === true) {
                // Half a win each, the same way a draw scores in any round
                // robin. Nothing goes into playoffBeat: the head-to-head
                // fallback below must not be decided by a coin flip.
                playoffWins!.set(vote.winnerId, (playoffWins!.get(vote.winnerId) ?? 0) + 0.5);
                playoffWins!.set(loserId, (playoffWins!.get(loserId) ?? 0) + 0.5);
            } else {
                playoffWins!.set(vote.winnerId, (playoffWins!.get(vote.winnerId) ?? 0) + 1);
                playoffBeat!.get(vote.winnerId)!.add(loserId);
            }
            playoffIndex += 1;
            voteIndex += 1;
            if (playoffIndex >= playoffSchedule!.length) phase = "done";
            continue;
        }

        break; // unreachable in practice, but keeps the loop provably terminating
    }

    // --- slow path: work out `current`, exactly once ----------------------
    //
    // Everything from `voteIndex` on (whether that's "ran out of votes," the
    // normal case, or "the log stopped matching," a corrupted save) is
    // unplayed. Either way this degrades to the last valid point rather than
    // discarding the tournament, same rationale as lib/swiss.ts's `derive`.
    let status: RankingDerived["status"] = "complete";
    let current: RankingCurrentMatchup | null = null;

    if (phase === "main" && !useRoundRobin) {
        const sorted = sortByRating(ids, ratings);
        const budgetReached = mainDecided >= budget;
        const settledEarly = adjacentSettledFraction(sorted, ratings) >= 1;
        if (budgetReached || settledEarly) {
            phase = shouldRunPlayoff(n) ? "playoff" : "done";
            if (phase === "playoff") {
                const topCut = sorted.slice(0, TOP_CUT_SIZE);
                playoffSchedule = roundRobinPairs(topCut);
                playoffWins = new Map(topCut.map((id) => [id, 0]));
                playoffBeat = new Map(topCut.map((id) => [id, new Set<string>()]));
            }
        } else {
            const [a, b] = pickNextMatchup(sorted, ratings, played);
            current = {
                pairingId: encodeAdaptivePairingId(mainDecided, a, b),
                a,
                b,
                numberInPhase: mainDecided + 1,
                phaseTotal: budget,
                isRematch: played.has(pairKey(a, b)),
            };
        }
    } else if (phase === "main" && useRoundRobin) {
        if (mainScheduleIndex < mainSchedule!.length) {
            const [a, b] = mainSchedule![mainScheduleIndex];
            current = {
                pairingId: `m${mainScheduleIndex}`,
                a,
                b,
                numberInPhase: mainScheduleIndex + 1,
                phaseTotal: mainSchedule!.length,
                isRematch: false,
            };
        } else {
            phase = "done";
        }
    }

    if (phase === "playoff" && playoffIndex < playoffSchedule!.length) {
        const [a, b] = playoffSchedule![playoffIndex];
        current = {
            pairingId: `p${playoffIndex}`,
            a,
            b,
            numberInPhase: playoffIndex + 1,
            phaseTotal: playoffSchedule!.length,
            isRematch: played.has(pairKey(a, b)),
        };
    } else if (phase === "playoff") {
        phase = "done";
    }

    status = current ? "in_progress" : "complete";

    const finalSorted = sortByRating(ids, ratings, { beat, wins, losses });
    const confidence = rankingConfidence(finalSorted, ratings);

    let orderedIds: string[];
    let championId: string | null;
    if (playoffWins) {
        const topCutIds = [...playoffWins.keys()];
        const topSet = new Set(topCutIds);
        const topOrdered = [...topCutIds].sort((x, y) => {
            const wx = playoffWins!.get(x) ?? 0;
            const wy = playoffWins!.get(y) ?? 0;
            if (wx !== wy) return wy - wx;
            // Tied on playoff wins: head-to-head from the playoff itself (a
            // full round robin among the top cut, so any two of them always
            // played each other directly) before falling back to rating.
            if (playoffBeat!.get(x)!.has(y)) return -1;
            if (playoffBeat!.get(y)!.has(x)) return 1;
            return ratings.get(y)!.rating - ratings.get(x)!.rating;
        });
        const rest = finalSorted.filter((id) => !topSet.has(id));
        orderedIds = [...topOrdered, ...rest];
        championId = status === "complete" ? topOrdered[0] : null;
    } else {
        orderedIds = finalSorted;
        championId = status === "complete" ? finalSorted[0] : null;
    }

    const standings: RankingStanding[] = orderedIds.map((id, i) => {
        const r = ratings.get(id)!;
        return {
            songId: id,
            rank: i + 1,
            rating: Math.round(r.rating),
            rd: Math.round(r.rd),
            wins: wins.get(id) ?? 0,
            losses: losses.get(id) ?? 0,
            ties: ties.get(id) ?? 0,
        };
    });

    const matchupsPlayed = mainDecided + playoffIndex;
    // See RankingDerived.matchupsPlanned's own doc comment for why this is a
    // lower bound, not a fixed target, once the playoff starts.
    const matchupsPlanned =
        phase === "main"
            ? (useRoundRobin ? mainSchedule!.length : budget)
            : mainDecided + (playoffSchedule?.length ?? 0);

    return {
        status,
        standings,
        championId,
        current,
        matchupsPlayed,
        matchupsPlanned,
        // `playoffSchedule` is only ever set at the moment of an actual
        // transition into the playoff phase -- unlike `phase !== "main"`,
        // this is false for a round-robin field (n <= ROUND_ROBIN_CEILING),
        // which goes straight from "main" to "done" and never runs one.
        inPlayoffs: playoffSchedule !== null,
        confidence,
    };
}

// ---------------------------------------------------------------------------
// Mutations (all return a new Tournament; none mutate their argument)
// ---------------------------------------------------------------------------

/** Records a vote, ignoring it if it doesn't answer the current matchup --
 * mirrors lib/swiss.ts's `recordVote`. */
export function recordRankingVote(
    tournament: Tournament,
    pairingId: string,
    winnerId: string,
    tie = false
): Tournament {
    const state = deriveRanking(tournament);
    const current = state.current;
    if (!current || current.pairingId !== pairingId) return tournament;
    if (winnerId !== current.a && winnerId !== current.b) return tournament;

    // `tie: true` is written only when it is true, never as `tie: false`.
    // Every vote saved before ties existed has no such key, and keeping the
    // decided case byte-identical to what it has always produced means a
    // ranking played entirely without the coin flip serialises exactly as it
    // did before this feature -- no diff in anyone's database row, nothing for
    // a future reader to have to treat as a third state.
    const vote: Vote = tie ? { pairingId, winnerId, tie: true } : { pairingId, winnerId };

    return {
        ...tournament,
        votes: [...tournament.votes, vote],
        updatedAt: new Date().toISOString(),
    };
}

/** Undoes the most recent vote. A no-op on a tournament with none. */
export function undoLastRankingVote(tournament: Tournament): Tournament {
    if (tournament.votes.length === 0) return tournament;
    return {
        ...tournament,
        votes: tournament.votes.slice(0, -1),
        updatedAt: new Date().toISOString(),
    };
}
