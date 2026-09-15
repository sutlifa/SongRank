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
import { deriveRanking, recordRankingVote, undoLastRankingVote, describeRankingPlan } from "./ranking";
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
    /** "4-0" either way -- wins-losses reads the same regardless of engine. */
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
    /** Fraction of the ranking confidently settled -- only ever non-null for
     * the adaptive engine, since Swiss has no uncertainty model to derive it
     * from. The UI shows this as "ranking is N% settled" when present. */
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
            recordLabel: `${s.wins}-${s.losses}`,
            detailLabel: `${s.rating} ± ${s.rd}`,
        })),
        matchupsPlayed: d.matchupsPlayed,
        matchupsPlanned: d.matchupsPlanned,
        inPlayoffs: d.inPlayoffs,
        confidence: d.confidence,
    };
}

/** Replays a tournament through whichever engine built it. Cheap enough to
 * call on every render, same contract as the engines it wraps. */
export function deriveTournament(t: Tournament): UnifiedDerived {
    return tournamentFormat(t) === "adaptive" ? fromRanking(t) : fromSwiss(t);
}

export function recordVote(t: Tournament, pairingId: string, winnerId: string): Tournament {
    return tournamentFormat(t) === "adaptive"
        ? recordRankingVote(t, pairingId, winnerId)
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
