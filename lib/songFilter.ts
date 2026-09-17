// lib/songFilter.ts
//
// "Where did my song end up?" -- filtering a list of songs that is already on
// screen, by text typed into a box above it.
//
// This is NOT catalogue search. lib/itunes.ts guesses at a song somebody has
// only half-remembered, against a catalogue of millions it cannot show them;
// being generous there is the whole job. Here the candidate set is thirty or
// three hundred rows the person is looking straight at, so generosity has the
// opposite effect: a filter that answers "all of them" has told you nothing
// and cost you the scroll position you had. The rules below are therefore
// deliberately stricter than the ones in lib/itunes.ts, and that asymmetry is
// intentional rather than an oversight.

import { normalizeForMatch } from "./parse";

/**
 * Shortest query that rule 2 in `songMatchesQuery` will consider.
 *
 * Rule 2 is a plain substring test, so without a floor it quietly undoes rule
 * 1's whole purpose the moment rule 1 fails: the one-character query "c" falls
 * through to it and matches every song whose title merely contains the letter,
 * "Sample Track 07" included. Three characters is the point where a fragment
 * is a fragment of something rather than just a letter -- "dont stop" and
 * "et it" both clear it comfortably, and nothing shorter carries enough signal
 * to be worth widening the list for.
 */
const MIN_TIGHT_MATCH = 3;

/** Just enough of a song to filter on. Both `Song` and a starter-list entry fit. */
export interface FilterableSong {
    title: string;
    artist: string;
}

/**
 * A query, prepared once for a whole list rather than re-split per row.
 *
 * Worth the separate step: `normalizeForMatch` runs a handful of regexes
 * including a Unicode property escape, and a three-hundred-song ranking
 * re-renders this filter on every keystroke.
 */
export interface SongQuery {
    tokens: string[];
    /** The query with its spaces closed up; see rule 2 in `songMatchesQuery`. */
    tight: string;
}

export function prepareSongQuery(raw: string): SongQuery {
    const normalised = normalizeForMatch(raw);
    return {
        tokens: normalised.split(" ").filter(Boolean),
        tight: normalised.replace(/\s+/g, ""),
    };
}

/**
 * True when `song` should stay visible under `query`.
 *
 * An empty query matches everything -- an unfiltered list is the resting
 * state of every screen this is used on, not a special case.
 *
 * Otherwise EITHER rule is enough:
 *
 *   1. every token starts a word of the title or artist, in any order --
 *      "go let" finds "Let It Go";
 *   2. or the whole query, spaces closed up, appears in the title and artist
 *      with their spaces closed up.
 *
 * Rule 2 is what rescues the punctuation nobody remembers: `normalizeForMatch`
 * turns an apostrophe into a SPACE, so "Don't Stop Me Now" normalises to
 * "don t stop me now" and there is no "dont" anywhere in it for rule 1 to
 * find. Closing up both sides puts "dontstop" back inside "dontstopmenow".
 * It also lets a fragment that starts mid-word land: "et it" -> "Let It Go".
 *
 * Rule 2 only applies from MIN_TIGHT_MATCH characters up; see that constant
 * for what goes wrong without the floor.
 *
 * Rule 1 is prefix-anchored rather than a plain substring, and that is the
 * load-bearing choice here. Substring matching per token looks fine until a
 * query contains a short one: "Band C" matched every row of a twenty-song
 * ranking, because "c" appears inside "track". Anchoring to word starts is
 * what makes a two-word query narrow the list instead of confirming it.
 */
export function songMatchesQuery(song: FilterableSong, query: SongQuery): boolean {
    if (query.tokens.length === 0) return true;
    const haystack = `${normalizeForMatch(song.title)} ${normalizeForMatch(song.artist)}`;
    const words = haystack.split(" ").filter(Boolean);
    if (query.tokens.every((t) => words.some((w) => w.startsWith(t)))) return true;
    if (query.tight.length < MIN_TIGHT_MATCH) return false;
    return haystack.replace(/\s+/g, "").includes(query.tight);
}
