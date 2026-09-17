// lib/tournamentEngine.ts
//
// Format dispatcher: the one module that knows both ranking engines exist.
// Everything downstream -- TournamentPlayer, ResultsView, StandingsPeek,
// HistoryList -- talks to the small "Unified*" shapes below and never
// imports lib/swiss.ts or lib/ranking.ts directly. Adding a third engine
// later means touching this file and the /new flow that picks a format;
// nothing else.
//
// "Unified" doesn't mean "identical": Swiss's `Derived` carries rounds, byes
// and OMW%, none of which mean anything for the adaptive engine, which in
// turn carries a rating/uncertainty concept Swiss has none of. This file
// adapts both into the handful of fields the shared player/results UI
// actually renders. A component that needs an engine's full native shape is
// free to import that engine directly -- nothing here prevents it -- but
// none of the shared UI needs to.

import {
    derive as deriveSwiss,
    recordVote as recordSwissVote,
    undoLastVote as undoLastSwissVote,
    recordLabel as swissRecordLabel,
    describePlan as describeSwissPlan,
    MAX_SONGS,
} from "./swiss";
import { deriveRanking, recordRankingVote, undoLastRankingVote, describeRankingPlan, estimateMatchups } from "./ranking";
import { plannedRounds, matchupsInRound } from "./swiss";
import type { RankingDepth } from "./types";
import type { Tournament, TournamentFormat } from "./types";

export { MAX_SONGS };

/**
 * The one place `Tournament.format`'s "absent means swiss" default is
 * applied -- see the doc comment on `TournamentFormat` in lib/types.ts for
 * why that default matters. Every function below routes through this rather
 * than reading `.format` itself.
 */
export function tournamentFormat(t: Pick<Tournament, "format">): TournamentFormat {
    return t.format ?? "swiss";
}

export interface UnifiedCurrentMatchup {
    pairingId: string;
    a: string;
    b: string;
    /** "Round 2 of 4" (Swiss) or "Ranking in progress" / "Top-cut playoff" (adaptive). */
    label: string;
    /** One line of extra context, or null when there's nothing to add. */
    note: string | null;
    numberInRound: number;
    matchupsInRound: number;
    isRematch: boolean;
}

export interface UnifiedStanding {
    songId: string;
    rank: number;
    /** "4-0" either way -- wins-losses reads the same regardless of engine --
     * or "4-0-1" when the adaptive engine has ties to report. */
    recordLabel: string;
    /** Engine-specific detail: "78% OMW" for Swiss, "1612 ± 40" for adaptive. */
    detailLabel: string;
}

export interface UnifiedDerived {
    status: "empty" | "in_progress" | "complete";
    championId: string | null;
    current: UnifiedCurrentMatchup | null;
    standings: UnifiedStanding[];
    matchupsPlayed: number;
    matchupsPlanned: number;
    inPlayoffs: boolean;
    /** True when this engine understands a matchup answered "I can't separate
     * these" -- i.e. the "Flip a coin" button. Only the adaptive engine does:
     * Elo has a natural draw, whereas Swiss is built on whole match points,
     * byes and opponent match-win percentage, none of which have a half. The
     * player UI hides the button entirely rather than lying to the older
     * engine, which only ever affects rankings saved before the adaptive
     * engine existed. */
    supportsTies: boolean;
    /**
     * Fraction of the ranking confidently settled -- only ever non-null for
     * the adaptive engine, since Swiss has no uncertainty model to derive it
     * from.
     *
     * NOTHING RENDERS THIS TODAY. It was shown on the player as "ranking is
     * N% settled" and withdrawn: it counts the fraction of ALL pairs whose
     * order is provable beyond the uncertainty in their two ratings, which on
     * a long list includes neighbours a few rating points apart where "these
     * two are a coin flip" is the honest answer. So a ranking whose ORDER is
     * about 97% right (the measured rank correlation, in
     * scripts/verify-ranking.ts) advertised itself as 83% and read as "17% of
     * this is wrong".
     *
     * Kept, rather than deleted, because the number itself is sound and
     * tested -- it answers "how much of this is provable", which is a real
     * question, just not one that belongs in a progress line. Anything
     * surfacing it again needs to say what it means, not just print it.
     */
    confidence: number | null;
}

function fromSwiss(t: Tournament): UnifiedDerived {
    const d = deriveSwiss(t);
    return {
        status: d.status,
        championId: d.championId,
        current: d.current
            ? {
                  pairingId: d.current.pairing.id,
                  a: d.current.pairing.a,
                  // Swiss's `current` is always a real matchup, never the bye
                  // pairing (see lib/swiss.ts's derive loop, which skips byes
                  // entirely when picking `current`), so `b` is never null here.
                  b: d.current.pairing.b!,
                  label: d.current.round.label,
                  note: d.current.round.note,
                  numberInRound: d.current.numberInRound,
                  matchupsInRound: d.current.matchupsInRound,
                  isRematch: d.current.pairing.isRematch,
              }
            : null,
        standings: d.standings.map((s) => ({
            songId: s.songId,
            rank: s.rank,
            recordLabel: swissRecordLabel(s),
            detailLabel: `${(s.omw * 100).toFixed(0)}% OMW`,
        })),
        matchupsPlayed: d.matchupsPlayed,
        matchupsPlanned: d.matchupsPlanned,
        inPlayoffs: d.inPlayoffs,
        supportsTies: false,
        confidence: null,
    };
}

function fromRanking(t: Tournament): UnifiedDerived {
    const d = deriveRanking(t);
    return {
        status: d.status,
        championId: d.championId,
        current: d.current
            ? {
                  pairingId: d.current.pairingId,
                  a: d.current.a,
                  b: d.current.b,
                  label: d.inPlayoffs ? "Top-cut playoff" : "Ranking in progress",
                  note: d.inPlayoffs
                      ? "The leading songs are playing a short round robin so first place is settled head-to-head, not just by rating."
                      : null,
                  numberInRound: d.current.numberInPhase,
                  matchupsInRound: d.current.phaseTotal,
                  isRematch: d.current.isRematch,
              }
            : null,
        standings: d.standings.map((s) => ({
            songId: s.songId,
            rank: s.rank,
            // Ties only join the label once there are some, so a ranking
            // played without the coin flip still reads "4-0", not "4-0-0".
            recordLabel: s.ties > 0 ? `${s.wins}-${s.losses}-${s.ties}` : `${s.wins}-${s.losses}`,
            detailLabel: `${s.rating} ± ${s.rd}`,
        })),
        matchupsPlayed: d.matchupsPlayed,
        matchupsPlanned: d.matchupsPlanned,
        inPlayoffs: d.inPlayoffs,
        supportsTies: true,
        confidence: d.confidence,
    };
}

/** Replays a tournament through whichever engine built it. Cheap enough to
 * call on every render, same contract as the engines it wraps. */
export function deriveTournament(t: Tournament): UnifiedDerived {
    return tournamentFormat(t) === "adaptive" ? fromRanking(t) : fromSwiss(t);
}

/**
 * Records a vote. `tie` is the "Flip a coin" answer -- see `Vote.tie` in
 * lib/types.ts.
 *
 * It is dropped, not translated, for a Swiss tournament: that engine has no
 * draw (see `UnifiedDerived.supportsTies`), and writing a `tie` flag it will
 * never read would put a claim in someone's save that nothing honours. The
 * player UI doesn't offer the button there, so this is a belt-and-braces
 * guard rather than a path anyone reaches.
 */
export function recordVote(t: Tournament, pairingId: string, winnerId: string, tie = false): Tournament {
    return tournamentFormat(t) === "adaptive"
        ? recordRankingVote(t, pairingId, winnerId, tie)
        : recordSwissVote(t, pairingId, winnerId);
}

export function undoLastVote(t: Tournament): Tournament {
    return tournamentFormat(t) === "adaptive" ? undoLastRankingVote(t) : undoLastSwissVote(t);
}

/** The up-front "here's what starting this will cost" pitch, format-aware.
 * `depth` is ignored for "swiss" (Swiss has no depth concept). */
export function describePlan(n: number, format: TournamentFormat, depth: RankingDepth): string {
    return format === "adaptive" ? describeRankingPlan(n, depth) : describeSwissPlan(n);
}

/**
 * A rough "looks finished" guess from a tournament's COUNTS alone -- no song
 * list, no vote log, nothing that has to come out of a jsonb column.
 *
 * That constraint is the whole reason it exists. The rankings list shows
 * dozens of entries and needs to sort them into finished and in-progress;
 * asking each one's real status means replaying its vote log, which means
 * fetching every vote of every ranking to draw one page. This decides from
 * four integers the list already has.
 *
 * Never load-bearing. Being wrong costs a ranking appearing under the wrong
 * heading until it is opened, and both the player and the results screen
 * re-derive the true status from the vote log the moment they load. Where a
 * caller has the real thing (see `getTopCuts` in lib/queries.ts, which has to
 * derive anyway), it should prefer it and use this only for the rest.
 *
 * The two engines need very different thresholds: Swiss finishes in roughly
 * `plannedRounds * matchupsInRound` votes, while an adaptive tournament's
 * main phase alone targets `~1.25 * n * log2(n)` at Thorough -- an order of
 * magnitude more for a large field. Using the Swiss estimate for both (as the
 * history list did, back when Swiss was the only engine) called a
 * barely-started adaptive tournament finished as soon as it reached n - 1
 * votes.
 */
export function looksComplete(t: {
    songs: number;
    votes: number;
    format?: TournamentFormat;
    depth?: RankingDepth | null;
}): boolean {
    if (t.songs <= 1) return true;
    if ((t.format ?? "swiss") === "adaptive") {
        return t.votes >= estimateMatchups(t.songs, t.depth ?? "thorough");
    }
    return t.votes >= plannedRounds(t.songs) * matchupsInRound(t.songs);
}
