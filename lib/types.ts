// lib/types.ts
//
// The shared vocabulary of the app. Everything persisted -- localStorage for a
// signed-out user, a JSONB column for a signed-in one -- is one of these
// shapes, so a change here is a change to the save format. Add fields, don't
// repurpose them.

/** Clip lengths the user can choose between on a matchup card. */
export const CLIP_SECONDS = [10, 15, 30] as const;
export type ClipSeconds = (typeof CLIP_SECONDS)[number];

/**
 * One song in a tournament.
 *
 * `previewUrl` and `artworkUrl` are both nullable on purpose: they come from
 * the iTunes Search API, which is a best-effort match against free text, and
 * plenty of real tracks simply have no 30-second preview. A song with neither
 * is still a first-class entrant -- it is voted on by title and artist alone.
 */
export interface Song {
    /**
     * Stable within a tournament; used as the key in every pairing and vote.
     * Never touched by a "Change version" swap (see lib/songVersion.ts) --
     * that is the entire mechanism that makes swapping a recording mid-
     * tournament safe: every past `Vote.winnerId` and pairing id points at
     * this, never at title/artist/previewUrl, so nothing about the ranking
     * can move as long as this stays put.
     */
    id: string;
    title: string;
    artist: string;
    /** iTunes `collectionName`. Shown, not used for matching anything. See the
     * optionality note on `itunesId` below -- the same reasoning applies here. */
    album?: string | null;
    /** iTunes `artworkUrl100`, upgraded to a larger size when we render it. */
    artworkUrl: string | null;
    /** iTunes `previewUrl` (m4a, 30s), or null when resolution found nothing. */
    previewUrl: string | null;
    /** Length of the preview file in seconds, when the upstream reported one. */
    previewSeconds: number | null;
    /**
     * Short, user-facing reason there is no clip ("No preview available",
     * "Couldn't reach Apple Music"). Shown on the card so a missing player
     * reads as a known state rather than a broken one.
     */
    previewNote: string | null;
    /**
     * The iTunes track id this recording resolved to, or null (a fixture, an
     * unmatched paste import, or a tournament saved before this field
     * existed). Not read by anything load-bearing -- it's carried along
     * purely so a later "Change version" swap or re-resolve has something
     * more precise than title/artist text to key off, the same reason
     * SearchResult already carried it.
     *
     * `album` and `itunesId` are both optional (rather than required like
     * the fields above) for the same reason `Tournament.format` is optional:
     * every song saved before this pair of fields existed -- in a signed-in
     * user's database row just as much as a signed-out browser's
     * localStorage -- simply doesn't have them. Typing them as required
     * would be a lie about data that already exists.
     */
    itunesId?: number | null;
}

/** A recorded human decision. Votes are the *only* thing we persist about play. */
export interface Vote {
    /** The pairing this answered, e.g. "s3-2" (Swiss) or "m41" / "p2" (adaptive). Validated on replay. */
    pairingId: string;
    winnerId: string;
    /**
     * True when the listener had no preference and hit "Flip a coin" instead
     * of picking a side. The adaptive engine then applies the matchup as an
     * Elo *draw* -- both songs score 0.5, neither is credited with a win or a
     * loss, and the pair is left out of the head-to-head tiebreak map, because
     * "I couldn't separate these" is a genuine piece of information and
     * recording it as a win would be a lie the ratings then act on.
     *
     * `winnerId` is still filled in, with a genuinely random one of the two.
     * That is deliberate on both counts:
     *
     *   - Present, so a tie vote is structurally identical to every other vote
     *     and replay's existing "winnerId must be one of this pairing's two
     *     participants" validation needs no special case to accept it.
     *   - Random rather than always the A side, so anything that reads
     *     `winnerId` without understanding `tie` -- an older client still
     *     running against a freshly saved ranking, the legacy Swiss engine,
     *     a future export -- degrades to an unbiased coin flip rather than
     *     silently handing every undecided matchup to whichever song happened
     *     to be rendered on the left.
     *
     * Optional, like `Tournament.format` and `Song.album`: every vote saved
     * before this field existed simply has no `tie`, and absent means "a real
     * decision", which is exactly what those votes were.
     */
    tie?: boolean;
}

/**
 * Which ranking engine produced (and must replay) a tournament's pairings.
 *
 * Every tournament saved before this field existed -- in a signed-in user's
 * database row just as much as a signed-out browser's localStorage -- simply
 * has no `format` at all. That is why it lives on `Tournament` as optional
 * rather than required: a reader that treated an absent value as anything
 * other than "swiss" (throwing, or guessing "adaptive") would either break a
 * user's saved history outright or replay their old votes against pairing
 * ids the Swiss engine never generated. `tournamentFormat()` in
 * lib/tournamentEngine.ts is the one place that default is applied; nowhere
 * else should read `.format` directly.
 */
export type TournamentFormat = "swiss" | "adaptive";

/**
 * How thoroughly an adaptive tournament ranks its field before moving into
 * the top-cut playoff -- see lib/ranking.ts's `RANKING_DEPTH_FACTORS`.
 *
 * Chosen once, on /new, and carried on the tournament (not recomputed from
 * the current song count on every load) so that resuming a tournament keeps
 * the same target it started with. Meaningless, and always absent, on a
 * "swiss" tournament.
 */
export type RankingDepth = "quick" | "balanced" | "thorough";

export const RANKING_DEPTHS: readonly RankingDepth[] = ["quick", "balanced", "thorough"];

/**
 * The saved shape of a tournament.
 *
 * Note what is *not* here: rounds, pairings, standings, the current matchup,
 * ratings. Those are all derived (see `derive` in lib/swiss.ts for the Swiss
 * engine and `deriveRanking` in lib/ranking.ts for the adaptive one) from the
 * seeded song list plus the vote log, and the derivation is deterministic.
 * That is what makes undo a one-line `votes.pop()`, makes a mid-tournament
 * refresh safe, and keeps a half-finished tournament small enough to sit in
 * localStorage.
 */
export interface Tournament {
    /** Public id, the `[id]` in /t/[id]. Not a database key. */
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    clipSeconds: ClipSeconds;
    /** See the TournamentFormat doc comment above -- absent means "swiss". */
    format?: TournamentFormat;
    /** Only meaningful when format is "adaptive"; see RankingDepth. */
    depth?: RankingDepth;
    /** Seed order. Index in this array is the seed, and the final tiebreaker. */
    songs: Song[];
    votes: Vote[];
}

export type RoundKind = "swiss" | "playoff";

/** One matchup. `b === null` means a bye, which is auto-won by `a`. */
export interface Pairing {
    id: string;
    round: number;
    /** Position within the round, 0-based. */
    index: number;
    kind: RoundKind;
    a: string;
    b: string | null;
    winner: string | null;
    isBye: boolean;
    /**
     * True when these two have already played. We only ever allow this after
     * an exhaustive search proves no rematch-free pairing of the score group
     * exists -- the UI says so, because otherwise it looks like a bug.
     */
    isRematch: boolean;
}

export interface Round {
    number: number;
    kind: RoundKind;
    /** "Round 2 of 4" / "Playoff Round 1". */
    label: string;
    /** One line explaining a playoff round's existence. Null for Swiss rounds. */
    note: string | null;
    pairings: Pairing[];
    complete: boolean;
}

export interface Standing {
    songId: string;
    rank: number;
    wins: number;
    losses: number;
    byes: number;
    /** 3 per win; byes count as wins. */
    points: number;
    /** Opponent match-win percentage, 0..1. */
    omw: number;
    /** Ids of every non-bye opponent faced so far. */
    opponents: string[];
}

export interface CurrentMatchup {
    round: Round;
    pairing: Pairing;
    /** 1-based, byes excluded -- this is what "Matchup 3 of 7" counts. */
    numberInRound: number;
    matchupsInRound: number;
}

export interface Derived {
    plannedRounds: number;
    rounds: Round[];
    /** Sorted best-first. This is the final ranking once status is "complete". */
    standings: Standing[];
    status: "empty" | "in_progress" | "complete";
    championId: string | null;
    current: CurrentMatchup | null;
    /** Non-bye matchups decided so far. */
    matchupsPlayed: number;
    /** Best current estimate of the total, for the progress bar. */
    matchupsPlanned: number;
    /** True when an extra sudden-death phase is running. */
    inPlayoffs: boolean;
}

/** A song as it comes out of the paste parser, before the user reviews it. */
export interface ParsedSong {
    title: string;
    artist: string;
    /** The original line, so the review table can show what we started from. */
    raw: string;
    /**
     * True when the line used a separator that doesn't say which side is which
     * ("Daft Punk - Around the World" and "Around the World - Daft Punk" are
     * the same string shape). The review table flags these for a swap.
     */
    ambiguous: boolean;
}

export interface ParseResult {
    songs: ParsedSong[];
    /** Lines dropped because an identical song was already in the list. */
    duplicates: number;
    /** Lines dropped because the list hit MAX_SONGS. */
    truncated: number;
}

/** A search hit from our own /api/songs/search. */
export interface SearchResult {
    title: string;
    artist: string;
    album: string | null;
    artworkUrl: string | null;
    previewUrl: string | null;
    previewSeconds: number | null;
    itunesId: number | null;
}
