// lib/compare.ts
//
// Comparing two people's rankings of (roughly) the same songs. Pure: takes
// two already-derived standing orders and produces the numbers a comparison
// page renders. No React, no Next, no I/O.
//
// ## Matching songs across two rankings
//
// Two rankings are separate rows with separate song arrays, so "the same
// song" has to be established rather than assumed. Two passes, in this order:
//
//   1. **By song id.** A copied list keeps the original's song ids verbatim
//      (see copyTournament in lib/queries.ts), so for the case this feature
//      exists to serve -- you copied my list and ranked it yourself -- every
//      song matches exactly. It also survives a "Change version" swap, which
//      rewrites a song's title and artist but never its id (see
//      lib/songVersion.ts); matching on text alone would quietly drop a song
//      the moment either side swapped a recording.
//   2. **By normalised title + artist**, for anything left over. This is what
//      catches two people who independently built lists that happen to
//      overlap, where no id could ever line up.
//
// Pass 1 before pass 2 matters: ids are exact, text is a heuristic, and a
// song that matched exactly must never be re-matched to something else by a
// looser rule.

/** One side's ranking, reduced to what a comparison needs. */
export interface CompareEntry {
    songId: string;
    title: string;
    artist: string;
    rank: number;
}

export interface ComparedSong {
    title: string;
    artist: string;
    /** 1-based rank on the left-hand ranking. */
    mine: number;
    /** 1-based rank on the right-hand ranking. */
    theirs: number;
    /** theirs - mine. Positive means the left side liked it more. */
    delta: number;
}

export interface Comparison {
    /** Songs both rankings contain, ordered by the left side's rank. */
    shared: ComparedSong[];
    /** Titles only on the left, and only on the right -- context for why a
     * comparison covers fewer songs than either list has. */
    onlyMine: string[];
    onlyTheirs: string[];
    /**
     * Spearman rank correlation over the shared songs: 1 means identical
     * taste, 0 means unrelated, -1 means exactly opposite. Null when fewer
     * than two songs are shared, where the concept has no meaning -- one
     * song is trivially "in the same order" as itself and reporting 1.0 for
     * that would be a lie dressed as agreement.
     */
    correlation: number | null;
    /** Shared songs the two sides placed at exactly the same rank. */
    agreements: number;
    /** The shared songs with the largest |delta|, biggest first, capped. */
    biggestDisagreements: ComparedSong[];
}

/** How many rows the "you disagreed most about these" section shows. */
const DISAGREEMENT_LIMIT = 5;

/** Same normalisation both sides of a text match go through, so "Let It Go "
 * and "let it go" are one song. Deliberately light: lowercase, collapse
 * whitespace, drop surrounding punctuation. Nothing clever, because a clever
 * normaliser that merges two genuinely different songs is worse than one that
 * misses a match -- a missed match shows up honestly as "only in your list". */
function normalise(text: string): string {
    return text
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
        .trim();
}

function textKey(entry: CompareEntry): string {
    return `${normalise(entry.title)}|${normalise(entry.artist)}`;
}

/**
 * Spearman's rho over paired ranks.
 *
 * Both inputs are already dense ranks 1..n over the *shared* set (the caller
 * re-ranks before calling), so there are no ties and the shortcut formula
 * 1 - 6*sum(d^2) / (n * (n^2 - 1)) is exact rather than an approximation.
 */
function spearman(pairs: { mine: number; theirs: number }[]): number | null {
    const n = pairs.length;
    if (n < 2) return null;
    let sumD2 = 0;
    for (const p of pairs) {
        const d = p.mine - p.theirs;
        sumD2 += d * d;
    }
    return 1 - (6 * sumD2) / (n * (n * n - 1));
}

/**
 * Compares two ranked lists.
 *
 * `mine` and `theirs` are each in rank order, best first, with `rank`
 * already 1-based and dense.
 */
export function compareRankings(mine: CompareEntry[], theirs: CompareEntry[]): Comparison {
    // --- pass 1: exact, by song id -----------------------------------------
    const theirsById = new Map(theirs.map((e) => [e.songId, e]));
    const matched = new Map<string, CompareEntry>(); // my songId -> their entry
    const theirsMatched = new Set<string>();

    for (const m of mine) {
        const hit = theirsById.get(m.songId);
        if (hit) {
            matched.set(m.songId, hit);
            theirsMatched.add(hit.songId);
        }
    }

    // --- pass 2: by normalised text, over what pass 1 left behind ----------
    //
    // Built from only the unmatched entries on both sides, so an id match can
    // never be overwritten here. A duplicate text key on the right (the same
    // title and artist twice in one list, which the import de-duplicates but
    // an old row could still contain) keeps the first occurrence: arbitrary,
    // but deterministic, and preferable to matching one of mine to both.
    const leftoverTheirs = new Map<string, CompareEntry>();
    for (const t of theirs) {
        if (theirsMatched.has(t.songId)) continue;
        const key = textKey(t);
        if (!leftoverTheirs.has(key)) leftoverTheirs.set(key, t);
    }

    for (const m of mine) {
        if (matched.has(m.songId)) continue;
        const hit = leftoverTheirs.get(textKey(m));
        if (hit && !theirsMatched.has(hit.songId)) {
            matched.set(m.songId, hit);
            theirsMatched.add(hit.songId);
        }
    }

    // --- re-rank within the shared set -------------------------------------
    //
    // Ranks are compared against the shared songs only, not against each
    // side's full list. Otherwise a song I ranked 3rd of 30 and you ranked 3rd
    // of 12 would look like perfect agreement while meaning quite different
    // things, and every song below a non-shared one would carry an offset that
    // has nothing to do with taste.
    const sharedMine = mine.filter((m) => matched.has(m.songId)).sort((a, b) => a.rank - b.rank);
    const sharedTheirsOrder = [...matched.values()].sort((a, b) => a.rank - b.rank);
    const theirDenseRank = new Map(sharedTheirsOrder.map((e, i) => [e.songId, i + 1]));

    const shared: ComparedSong[] = sharedMine.map((m, i) => {
        const t = matched.get(m.songId)!;
        const mineRank = i + 1;
        const theirsRank = theirDenseRank.get(t.songId)!;
        return {
            title: m.title,
            artist: m.artist,
            mine: mineRank,
            theirs: theirsRank,
            delta: theirsRank - mineRank,
        };
    });

    const onlyMine = mine.filter((m) => !matched.has(m.songId)).map((m) => m.title);
    const onlyTheirs = theirs.filter((t) => !theirsMatched.has(t.songId)).map((t) => t.title);

    const biggestDisagreements = [...shared]
        .filter((s) => s.delta !== 0)
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.mine - b.mine)
        .slice(0, DISAGREEMENT_LIMIT);

    return {
        shared,
        onlyMine,
        onlyTheirs,
        correlation: spearman(shared),
        agreements: shared.filter((s) => s.delta === 0).length,
        biggestDisagreements,
    };
}

/**
 * One line summarising how close two rankings are, for the top of the page.
 *
 * Bands rather than a bare number, because "0.62" means nothing to most
 * people and "mostly agree" does. The number is still shown next to it -- this
 * replaces the interpretation, not the evidence.
 */
export function describeCorrelation(correlation: number | null): string {
    if (correlation === null) return "Not enough songs in common to compare.";
    if (correlation >= 0.9) return "Almost identical taste.";
    if (correlation >= 0.7) return "Broad agreement, with a few real arguments.";
    if (correlation >= 0.4) return "Some common ground, plenty to argue about.";
    if (correlation >= 0.1) return "Barely related rankings.";
    if (correlation > -0.4) return "No relationship at all between these two.";
    return "Almost exactly opposite taste.";
}
