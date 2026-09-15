// lib/swiss.ts
//
// The Swiss pairing engine: pure functions over plain data. No React, no Next
// imports, no I/O, no randomness. Everything below is deterministic, and the
// whole app leans on that:
//
//   * A saved tournament is only the seeded song list plus an ordered vote log
//     (see `Tournament` in lib/types.ts). Rounds, pairings and standings are
//     recomputed with `derive` on every render.
//   * Undo is therefore `votes.slice(0, -1)` -- there is no half-mutated state
//     to unwind, so a misclick 40 matchups in costs one click to fix.
//   * A refresh mid-round replays to exactly the same matchup, because nothing
//     about the pairing depends on when it was computed.
//
// If you are tempted to cache a round or store `rounds` in the database: that
// is the thing this design deliberately avoids. Replay is cheap (a few hundred
// matchups at worst) and a derived-only state can never disagree with itself.

import type {
    CurrentMatchup,
    Derived,
    Pairing,
    Round,
    RoundKind,
    Song,
    Standing,
    Tournament,
} from "./types";

/**
 * Hard ceiling on a tournament's size.
 *
 * 256 songs is 8 planned rounds of 128 matchups -- around a thousand decisions,
 * which is already past what anyone finishes in one sitting. Beyond that the
 * tool stops being a ranking tool and becomes a chore, so we refuse the list
 * with a clear message instead of accepting it and producing an abandoned
 * session.
 */
export const MAX_SONGS = 256;

/** Minimum opponent match-win percentage, as in the MTG tournament rules. */
const MIN_MATCH_WIN_PCT = 0.33;

/**
 * Number of Swiss rounds for a field of `n`.
 *
 * ceil(log2(n)) is the round count that leaves (usually) a single unbeaten
 * player, which is exactly the shape we want here. The `Math.max(1, ...)`
 * floor matters for n = 2 and n = 3, where the log would otherwise round to 1
 * or 2 anyway -- but returns 0 below that, because a field of one song has no
 * pairing to make and a field of none has no tournament. Those two cases never
 * reach the pairing code; see `derive`.
 */
export function plannedRounds(n: number): number {
    if (n < 2) return 0;
    return Math.max(1, Math.ceil(Math.log2(n)));
}

/** Matchups in a round of `n` active songs. The odd one out takes a bye. */
export function matchupsInRound(n: number): number {
    return Math.floor(n / 2);
}

// ---------------------------------------------------------------------------
// Records and tiebreakers
// ---------------------------------------------------------------------------

interface SongRecord {
    wins: number;
    losses: number;
    byes: number;
    points: number;
    opponents: string[];
    /** Ids this song has beaten, for the head-to-head tiebreaker. */
    beat: Set<string>;
    /** Every opponent id it has been paired against, for rematch avoidance. */
    played: Set<string>;
    seed: number;
}

function blankRecord(seed: number): SongRecord {
    return { wins: 0, losses: 0, byes: 0, points: 0, opponents: [], beat: new Set(), played: new Set(), seed };
}

function blankRecords(songs: Song[]): Map<string, SongRecord> {
    const records = new Map<string, SongRecord>();
    songs.forEach((song, seed) => records.set(song.id, blankRecord(seed)));
    return records;
}

/**
 * Folds one round's *decided* pairings into the running records. Undecided
 * pairings contribute nothing but the fact that the two songs have met, which
 * still has to be recorded so the next round doesn't re-pair them.
 *
 * Applied round by round as `derive` walks forward rather than re-tallying the
 * whole history each time: re-tallying makes derivation quadratic in the round
 * count, and derive runs on every render and every vote.
 */
function applyRound(records: Map<string, SongRecord>, round: Round): void {
    for (const pairing of round.pairings) {
        const a = records.get(pairing.a);
        if (!a) continue;

        if (pairing.isBye) {
            // A bye is a win worth the usual 3 points, but it has no opponent,
            // so it must not land in `opponents` -- an opponent that doesn't
            // exist would otherwise drag OMW% around.
            a.byes += 1;
            a.wins += 1;
            a.points += 3;
            continue;
        }

        const b = pairing.b ? records.get(pairing.b) : undefined;
        if (!b || !pairing.b) continue;

        // Recorded even for an undecided pairing: these two have been put in
        // front of the user, so the next round must not offer them again.
        a.played.add(pairing.b);
        b.played.add(pairing.a);

        if (!pairing.winner) continue;

        a.opponents.push(pairing.b);
        b.opponents.push(pairing.a);

        const aWon = pairing.winner === pairing.a;
        const winner = aWon ? a : b;
        const loser = aWon ? b : a;
        const loserId = aWon ? pairing.b : pairing.a;

        winner.wins += 1;
        winner.points += 3;
        winner.beat.add(loserId);
        loser.losses += 1;
    }
}

/**
 * A song's own match-win percentage, floored at 0.33.
 *
 * The floor is the MTG rule and it exists so that one unlucky opponent who
 * lost every round doesn't crater everybody else's OMW%. Byes count as wins
 * here (they are wins), which is why `wins` already includes them.
 */
function matchWinPct(record: SongRecord): number {
    const played = record.wins + record.losses;
    if (played === 0) return MIN_MATCH_WIN_PCT;
    return Math.max(MIN_MATCH_WIN_PCT, record.points / (3 * played));
}

/** Mean opponent match-win percentage. Byes contribute no opponent at all. */
function opponentMatchWinPct(record: SongRecord, records: Map<string, SongRecord>): number {
    if (record.opponents.length === 0) return MIN_MATCH_WIN_PCT;
    let total = 0;
    for (const id of record.opponents) {
        const opponent = records.get(id);
        total += opponent ? matchWinPct(opponent) : MIN_MATCH_WIN_PCT;
    }
    return total / record.opponents.length;
}

/**
 * The standings comparator: match points, then OMW%, then head-to-head, then
 * seed.
 *
 * Head-to-head is not a total order (A beat B, B beat C, C beat A is legal),
 * so it can only ever be a tiebreaker *inside* an already-sorted run -- which
 * is exactly how it is used here. Seed is last and is unique, so the sort is
 * always fully determined and therefore stable across replays.
 */
function compareRecords(
    aId: string,
    bId: string,
    records: Map<string, SongRecord>,
    omw: Map<string, number>
): number {
    const a = records.get(aId);
    const b = records.get(bId);
    if (!a || !b) return 0;

    if (a.points !== b.points) return b.points - a.points;

    const aOmw = omw.get(aId) ?? 0;
    const bOmw = omw.get(bId) ?? 0;
    if (Math.abs(aOmw - bOmw) > 1e-9) return bOmw - aOmw;

    if (a.beat.has(bId) && !b.beat.has(aId)) return -1;
    if (b.beat.has(aId) && !a.beat.has(bId)) return 1;

    return a.seed - b.seed;
}

function omwTable(records: Map<string, SongRecord>): Map<string, number> {
    const omw = new Map<string, number>();
    for (const [id, record] of records) omw.set(id, opponentMatchWinPct(record, records));
    return omw;
}

/** Sorts ids best-first by the tiebreaker chain above. */
function sortByStanding(ids: string[], records: Map<string, SongRecord>): string[] {
    const omw = omwTable(records);
    return [...ids].sort((x, y) => compareRecords(x, y, records, omw));
}

// ---------------------------------------------------------------------------
// Pairing
// ---------------------------------------------------------------------------

function pairKey(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Budget for the rematch-free search, counted in recursive calls.
 *
 * Pairing a score group is a perfect-matching problem, and a naive search can
 * in principle blow up on a large group that is densely cross-played. In
 * practice the very first branch succeeds almost always (early rounds have no
 * rematches to avoid, and late score groups are small), so this budget is a
 * seatbelt rather than a throttle: when it runs out we fall back to the
 * rematch-allowing pass, which always succeeds immediately. Better a marked
 * rematch than a hung tab.
 */
const SEARCH_BUDGET = 40_000;

interface SearchState {
    steps: number;
}

/**
 * Exhaustive backtracking perfect matching over `ids`.
 *
 * A greedy sweep ("pair 1-2, 3-4, ...") can dead-end: it happily pairs the
 * early songs and leaves two at the end who have already played each other,
 * with no way to undo the choice that caused it. Backtracking fixes the whole
 * group at once, which is the only way to actually honour "avoid rematches".
 *
 * Returns null when no rematch-free matching exists (or the budget ran out).
 */
function matchAll(
    ids: string[],
    played: Set<string>,
    allowRematch: boolean,
    state: SearchState
): [string, string][] | null {
    if (ids.length % 2 === 1) return null;

    const used = new Array<boolean>(ids.length).fill(false);
    const result: [string, string][] = [];

    // Index-based rather than the obvious `[first, ...rest]` recursion: the
    // slicing version allocates two arrays per level, which on a 256-song
    // opening round is most of the work the engine does all tournament.
    const search = (paired: number): boolean => {
        if (paired === ids.length) return true;
        if (state.steps++ > SEARCH_BUDGET) return false;

        let i = 0;
        while (used[i]) i++;
        used[i] = true;

        for (let j = i + 1; j < ids.length; j++) {
            if (used[j]) continue;
            if (!allowRematch && played.has(pairKey(ids[i], ids[j]))) continue;

            used[j] = true;
            result.push([ids[i], ids[j]]);
            if (search(paired + 2)) return true;
            result.pop();
            used[j] = false;
        }

        used[i] = false;
        return false;
    };

    return search(0) ? result : null;
}

/**
 * Picks who takes the bye.
 *
 * Swiss: the *lowest*-standing song that has not had one yet. This looks
 * backwards -- the bye is a free win, so surely it should go to the leader? --
 * and that is exactly why it doesn't. A bye handed to an unbeaten song creates
 * a second unbeaten song without a match being played, which is how a field
 * ends the planned rounds with three "winners" and needs extra playoff rounds
 * to sort out. Giving it to the bottom of the standings keeps the free win
 * where it cannot manufacture a contender.
 *
 * Playoff: the opposite, the *highest*-standing survivor. By then everyone
 * left is tied on losses and the bye is a knockout pass, so awarding it to the
 * song with the best tiebreakers is the only defensible choice -- handing a
 * free semi-final pass to the weakest survivor would be absurd.
 *
 * Either way we prefer someone who has never had a bye, so no song coasts
 * twice while another plays every round.
 */
function chooseBye(standingOrder: string[], records: Map<string, SongRecord>, kind: RoundKind): string {
    const order = kind === "swiss" ? [...standingOrder].reverse() : standingOrder;
    const fresh = order.find((id) => (records.get(id)?.byes ?? 0) === 0);
    return fresh ?? order[0];
}

/**
 * Builds one round's pairings.
 *
 * Score groups are paired top-down. When a group has an odd number of songs
 * one has to float down into the next group; we try the lowest-standing member
 * first (the conventional choice -- the song with the weakest claim to its
 * group is the one that plays down), and back off to higher members only if
 * the lower float leaves the rest of the group unpairable without a rematch.
 */
function buildPairings(
    participants: string[],
    records: Map<string, SongRecord>,
    kind: RoundKind,
    roundNumber: number,
    /** Every matchup already put in front of the user, as pair keys. */
    played: Set<string>
): Pairing[] {
    const order = sortByStanding(participants, records);
    const pairings: Pairing[] = [];

    let pool = order;
    let byeId: string | null = null;
    if (pool.length % 2 === 1) {
        byeId = chooseBye(order, records, kind);
        pool = pool.filter((id) => id !== byeId);
    }

    // Score groups, in standing order. `pool` is already sorted, so a group
    // break is simply a change in match points.
    const groups: string[][] = [];
    for (const id of pool) {
        const points = records.get(id)?.points ?? 0;
        const last = groups[groups.length - 1];
        const lastPoints = last ? records.get(last[0])?.points ?? 0 : null;
        if (last && lastPoints === points) last.push(id);
        else groups.push([id]);
    }

    const matches: [string, string][] = [];
    const rematchKeys = new Set<string>();
    let carry: string[] = [];

    for (let g = 0; g < groups.length; g++) {
        const group = [...carry, ...groups[g]];
        carry = [];
        const isLastGroup = g === groups.length - 1;

        if (group.length === 0) continue;

        if (group.length % 2 === 1) {
            // Someone must float down. Try each candidate from the bottom up;
            // the first that leaves a pairable remainder wins. The last group
            // can never be odd (the pool as a whole is even and every float
            // above moved one song down), so this always has a group to float
            // into -- the `isLastGroup` guard below is belt and braces.
            let floated = false;
            for (let i = group.length - 1; i >= 0 && !isLastGroup; i--) {
                const candidate = group[i];
                const remainder = group.filter((_, j) => j !== i);
                const attempt = matchAll(remainder, played, false, { steps: 0 });
                if (attempt) {
                    matches.push(...attempt);
                    carry = [candidate];
                    floated = true;
                    break;
                }
            }
            if (!floated) {
                // No rematch-free split of this group exists. Float the bottom
                // song anyway and pair the rest with rematches allowed.
                const candidate = group[group.length - 1];
                const remainder = group.slice(0, -1);
                const attempt = matchAll(remainder, played, true, { steps: 0 }) ?? [];
                for (const [x, y] of attempt) {
                    if (played.has(pairKey(x, y))) rematchKeys.add(pairKey(x, y));
                }
                matches.push(...attempt);
                carry = isLastGroup ? [] : [candidate];
                if (isLastGroup && remainder.length !== group.length - 1) carry = [];
            }
            continue;
        }

        const clean = matchAll(group, played, false, { steps: 0 });
        if (clean) {
            matches.push(...clean);
            continue;
        }

        // Every arrangement of this group repeats a matchup. Allow it rather
        // than failing to produce a round -- and mark it, so the UI can say
        // "these two have met before" instead of looking broken.
        const dirty = matchAll(group, played, true, { steps: 0 }) ?? [];
        for (const [x, y] of dirty) {
            if (played.has(pairKey(x, y))) rematchKeys.add(pairKey(x, y));
        }
        matches.push(...dirty);
    }

    // A float left over after the final group (only reachable in the
    // rematch-fallback branch above) has no one to play; give it the bye if the
    // round has none, otherwise pair it back into the last match's group.
    if (carry.length === 1 && byeId === null) {
        byeId = carry[0];
        carry = [];
    }

    matches.forEach(([a, b], index) => {
        pairings.push({
            id: `${kind === "swiss" ? "s" : "p"}${roundNumber}-${index}`,
            round: roundNumber,
            index,
            kind,
            a,
            b,
            winner: null,
            isBye: false,
            isRematch: rematchKeys.has(pairKey(a, b)),
        });
    });

    if (byeId) {
        // The bye goes last so that "Matchup 3 of 7" counts only real matchups
        // and never skips a number.
        pairings.push({
            id: `${kind === "swiss" ? "s" : "p"}${roundNumber}-bye`,
            round: roundNumber,
            index: pairings.length,
            kind,
            a: byeId,
            b: null,
            winner: byeId,
            isBye: true,
            isRematch: false,
        });
    }

    return pairings;
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/**
 * The pool that a sudden-death playoff round is fought between: every song
 * tied on the fewest losses.
 *
 * Swiss *usually* leaves exactly one unbeaten song after ceil(log2(n)) rounds,
 * but byes and odd fields break that guarantee in both directions:
 *
 *   * Too many. Two or three songs can finish unbeaten (a bye plus a couple of
 *     wins gets there). The planned rounds are over, so the only way to settle
 *     it is to play them off against each other.
 *   * Too few -- zero. A lone leader in the top score group has nobody left at
 *     its own record to play, so it floats down and faces a song with a loss.
 *     If it loses that match, the field ends with *no* unbeaten song at all.
 *
 * Taking "fewest losses" rather than literally "unbeaten" handles both with
 * one rule: when anyone is unbeaten this is exactly the unbeaten set, and when
 * nobody is, it is the one-loss songs who have the strongest claim. Each
 * playoff round shrinks the pool (every match eliminates one, a bye eliminates
 * nobody but cannot be given twice in a row to the same shrinking set), so the
 * loop always terminates with exactly one song at the minimum.
 */
function fewestLossesPool(songs: Song[], records: Map<string, SongRecord>): string[] {
    let min = Infinity;
    for (const song of songs) {
        const losses = records.get(song.id)?.losses ?? 0;
        if (losses < min) min = losses;
    }
    return songs.filter((song) => (records.get(song.id)?.losses ?? 0) === min).map((song) => song.id);
}

function standingsFrom(songs: Song[], records: Map<string, SongRecord>): Standing[] {
    const omw = omwTable(records);
    const ordered = sortByStanding(
        songs.map((song) => song.id),
        records
    );
    return ordered.map((songId, i) => {
        const record = records.get(songId) ?? blankRecord(i);
        return {
            songId,
            rank: i + 1,
            wins: record.wins,
            losses: record.losses,
            byes: record.byes,
            points: record.points,
            omw: omw.get(songId) ?? MIN_MATCH_WIN_PCT,
            opponents: [...record.opponents],
        };
    });
}

/**
 * Replays a tournament from its song list and vote log.
 *
 * This is the only place rounds come into existence. It is called on every
 * render and after every vote; keep it cheap and keep it pure.
 */
export function derive(tournament: Tournament): Derived {
    const songs = tournament.songs;
    const n = songs.length;
    const planned = plannedRounds(n);

    if (n === 0) {
        return {
            plannedRounds: 0,
            rounds: [],
            standings: [],
            status: "empty",
            championId: null,
            current: null,
            matchupsPlayed: 0,
            matchupsPlanned: 0,
            inPlayoffs: false,
        };
    }

    if (n === 1) {
        // One song is already ranked. No rounds, no votes, immediate winner --
        // rather than a "tournament" with a single bye in it.
        const records = blankRecords(songs);
        return {
            plannedRounds: 0,
            rounds: [],
            standings: standingsFrom(songs, records),
            status: "complete",
            championId: songs[0].id,
            current: null,
            matchupsPlayed: 0,
            matchupsPlanned: 0,
            inPlayoffs: false,
        };
    }

    const rounds: Round[] = [];
    const allIds = songs.map((song) => song.id);
    let voteIndex = 0;
    let status: Derived["status"] = "complete";
    let championId: string | null = null;
    let current: CurrentMatchup | null = null;
    let playoffCount = 0;

    // Bounded because Swiss rounds are capped by `planned` and every playoff
    // round strictly shrinks the pool. The guard is here so that a future bug
    // in either of those claims shows up as a stalled tournament rather than a
    // frozen browser tab.
    const MAX_ROUNDS = planned + 32;

    // Carried forward across rounds and folded into after each round is
    // resolved, rather than recomputed from `rounds` every iteration.
    const records = blankRecords(songs);
    const played = new Set<string>();

    while (rounds.length < MAX_ROUNDS) {
        const kind: RoundKind = rounds.length < planned ? "swiss" : "playoff";

        let participants: string[];
        if (kind === "swiss") {
            participants = allIds;
        } else {
            participants = fewestLossesPool(songs, records);
            if (participants.length <= 1) {
                championId = participants[0] ?? null;
                break;
            }
            playoffCount += 1;
        }

        const roundNumber = rounds.length + 1;
        const pairings = buildPairings(participants, records, kind, roundNumber, played);

        let complete = true;
        let numberInRound = 0;
        let pendingPairing: Pairing | null = null;
        const matchupsThisRound = pairings.filter((pairing) => !pairing.isBye).length;

        for (const pairing of pairings) {
            if (pairing.isBye) continue;
            numberInRound += 1;

            const vote = tournament.votes[voteIndex];
            const validWinner = vote && (vote.winnerId === pairing.a || vote.winnerId === pairing.b);
            if (vote && vote.pairingId === pairing.id && validWinner) {
                pairing.winner = vote.winnerId;
                voteIndex += 1;
                continue;
            }

            // Either we've run out of votes (the normal case: this is where the
            // user is) or the log doesn't line up with the pairing it claims to
            // answer. Both stop the replay here; a mismatched log is treated as
            // if it ended, which degrades a corrupted save to an earlier point
            // in the same tournament instead of throwing it away.
            complete = false;
            pendingPairing = pairing;
            break;
        }

        const round: Round = {
            number: roundNumber,
            kind,
            label:
                kind === "swiss"
                    ? `Round ${roundNumber} of ${planned}`
                    : `Playoff Round ${playoffCount}`,
            note:
                kind === "swiss"
                    ? null
                    : `${participants.length} songs are still tied for the lead after the Swiss rounds, so they play sudden death until one is left.`,
            pairings,
            complete,
        };
        rounds.push(round);
        applyRound(records, round);
        for (const pairing of pairings) {
            if (!pairing.isBye && pairing.b) played.add(pairKey(pairing.a, pairing.b));
        }

        if (!complete && pendingPairing) {
            status = "in_progress";
            current = {
                round,
                pairing: pendingPairing,
                numberInRound,
                matchupsInRound: matchupsThisRound,
            };
            break;
        }
    }

    const standings = standingsFrom(songs, records);

    if (status === "complete" && championId === null) {
        championId = standings[0]?.songId ?? null;
    }

    const matchupsPlayed = rounds.reduce(
        (total, round) => total + round.pairings.filter((pairing) => !pairing.isBye && pairing.winner).length,
        0
    );
    const remainingInCurrent = current
        ? current.matchupsInRound - (current.numberInRound - 1)
        : 0;
    const plannedSwiss = planned * matchupsInRound(n);

    return {
        plannedRounds: planned,
        rounds,
        standings,
        status,
        championId,
        current,
        matchupsPlayed,
        // The Swiss estimate (`plannedSwiss`) is exact until playoffs start.
        // Once they do, this becomes "at least this many, plus whatever the
        // playoff round in progress still has left" -- a lower bound, not a
        // fixed target, because further playoff rounds are possible and this
        // function has no way to know in advance whether one more will be
        // needed. That lower bound is *not* monotonic as a played/planned
        // ratio: the moment a playoff round starts, its whole matchup count
        // is added to the denominator in one step (`remainingInCurrent`)
        // while the numerator (`matchupsPlayed`) hasn't moved yet, so a naive
        // percentage can dip right at that transition. A caller rendering
        // this as a progress bar needs to smooth that itself (see
        // TournamentPlayer's ratchet, which never lets displayed progress
        // fall except on an actual undo) -- it isn't something this function
        // can guarantee on its own, because the *true* total is genuinely
        // unknowable until the last playoff round resolves.
        matchupsPlanned: Math.max(plannedSwiss, matchupsPlayed + remainingInCurrent),
        inPlayoffs: (current?.round.kind ?? rounds[rounds.length - 1]?.kind) === "playoff",
    };
}

// ---------------------------------------------------------------------------
// Mutations (all return a new Tournament; none mutate their argument)
// ---------------------------------------------------------------------------

/** Records a vote, ignoring it if it doesn't answer the current matchup. */
export function recordVote(tournament: Tournament, pairingId: string, winnerId: string): Tournament {
    const state = derive(tournament);
    const pairing = state.current?.pairing;
    if (!pairing || pairing.id !== pairingId) return tournament;
    if (winnerId !== pairing.a && winnerId !== pairing.b) return tournament;

    return {
        ...tournament,
        votes: [...tournament.votes, { pairingId, winnerId }],
        updatedAt: new Date().toISOString(),
    };
}

/** Undoes the most recent vote. A no-op on a tournament with none. */
export function undoLastVote(tournament: Tournament): Tournament {
    if (tournament.votes.length === 0) return tournament;
    return {
        ...tournament,
        votes: tournament.votes.slice(0, -1),
        updatedAt: new Date().toISOString(),
    };
}

/** "4-0" for the results table. Byes are included in the win count. */
export function recordLabel(standing: Standing): string {
    return `${standing.wins}-${standing.losses}`;
}

/**
 * The up-front pitch: "14 songs → 4 rounds, 7 matchups in round 1".
 *
 * The "+ tiebreakers if needed" half is not hedging, it is arithmetic. When `n`
 * is a power of two the unbeaten group halves cleanly every round and the
 * planned rounds land on exactly one unbeaten song every time. When it is not,
 * the odd song out floats down to play someone who has already lost, and that
 * float can leave the field with two unbeaten songs -- or, just as often, with
 * none at all, because the last perfect record lost on a float-down. Simulation
 * over n = 2..200 puts the average overrun at roughly one extra round for a
 * field like 40 or 100. Promising a bare round count for those sizes would be a
 * promise the pairing maths cannot keep, so we say so here instead of
 * surprising the user with a "Playoff Round 1" they were never told about.
 */
export function describePlan(n: number): string {
    // `derive()` above is happy to crown a single song champion with no
    // rounds played (see its n === 1 branch) -- that's the right behavior
    // for e.g. an undo that empties a field back down to one survivor mid-
    // tournament. But *starting* a tournament at n = 1 is a product decision,
    // not an engine one, and the app's answer is no (components/
    // NewTournament.tsx blocks the Start button below 2 songs): ranking a
    // single song against nothing isn't a tournament. This message has to
    // agree with that, not describe a "starts fine" path the UI refuses.
    if (n < 2) return n === 1 ? "1 song — add at least one more to start a tournament" : "No songs yet";
    const rounds = plannedRounds(n);
    const first = matchupsInRound(n);
    const exact = (n & (n - 1)) === 0;
    const tail = exact ? "" : " (+ tiebreakers if needed)";
    return `${n} songs → ${rounds} round${rounds === 1 ? "" : "s"}${tail}, ${first} matchup${first === 1 ? "" : "s"} in round 1`;
}
