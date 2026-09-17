// lib/fuzzy.ts
//
// "Close enough" for single words, used when scoring what the song catalogue
// sent back against what somebody actually typed (see `coverage` in
// lib/itunes.ts).
//
// The case that prompted this: a search for "Chicken Huntin'" scored zero
// title overlap against the recording Apple files as "Chickin 'Pluckin'
// Huntin Remix", because token matching was exact string equality and
// "chicken" is not "chickin". One letter. Apple had returned the track --
// our own scoring is what threw it away, which is the worst version of this
// bug, since it looks from the outside like the catalogue is missing a song
// that is right there.
//
// Where this deliberately does NOT get used:
//
//   - lib/songFilter.ts, the results-page filter. That narrows a list the
//     person is looking straight at, where a near-miss is noise rather than
//     rescue; see that file's header.
//   - the raw search query sent upstream. Apple does its own matching and we
//     cannot make it fuzzier from here. This only ever widens what we accept
//     from among the candidates it already returned -- it can rescue a real
//     hit from our scoring, never conjure one.

/**
 * Damerau-Levenshtein (optimal string alignment) distance, abandoned once it
 * is certain to exceed `cutoff`.
 *
 * Damerau rather than plain Levenshtein because a transposition is one of the
 * most common ways to mistype a word -- "beleive" for "believe" is a single
 * slip of two fingers, and plain Levenshtein scores it 2, the same as two
 * unrelated errors.
 *
 * The cutoff is not just an optimisation: every caller has a threshold, and a
 * pair of long, entirely different words is the common case here (most
 * candidates are wrong). Bailing early keeps that case cheap.
 */
export function editDistance(a: string, b: string, cutoff = Infinity): number {
    if (a === b) return 0;
    // A length gap alone already exceeds the cutoff -- no alignment can close
    // more than one character of it per edit.
    if (Math.abs(a.length - b.length) > cutoff) return cutoff + 1;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    let prev2: number[] = [];
    let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
    let curr: number[] = new Array(b.length + 1);

    for (let i = 1; i <= a.length; i++) {
        curr[0] = i;
        let rowBest = curr[0];
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            let best = Math.min(
                curr[j - 1] + 1, // insertion
                prev[j] + 1, // deletion
                prev[j - 1] + cost // substitution
            );
            // The transposition case: the last two characters of each string
            // are the same pair, swapped.
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                best = Math.min(best, prev2[j - 2] + 1);
            }
            curr[j] = best;
            if (best < rowBest) rowBest = best;
        }
        // Nothing in this row is within the cutoff, and a row can only ever
        // grow from here, so no later row can be either.
        if (rowBest > cutoff) return cutoff + 1;
        prev2 = prev;
        prev = curr;
        curr = new Array(b.length + 1);
    }
    return prev[b.length];
}

/**
 * How much misspelling to forgive in a word of this length.
 *
 * Scaled, because a fixed allowance is wrong at both ends. One edit in a
 * four-letter word is a DIFFERENT word far more often than it is a typo --
 * "love"/"live", "fire"/"fine", "mine"/"nine" -- and songs are full of short
 * common words, so those get no latitude at all. Two edits in a fifteen-letter
 * word is a rounding error.
 *
 * The thresholds are deliberately mean. This runs on every token of every
 * candidate, and a false match here promotes a wrong recording into somebody's
 * ranking, where it is much harder to notice than a missing one.
 */
function allowanceFor(length: number): number {
    if (length <= 4) return 0;
    if (length <= 8) return 1;
    return 2;
}

/**
 * True when `a` and `b` are the same word, or near enough to be a misspelling
 * of it. Both are expected to be already normalised (see `normalizeForMatch`
 * in lib/parse.ts) -- this compares words, not raw text.
 *
 * The allowance is taken from the SHORTER word, so a short word cannot be
 * stretched to reach a long one: "mix" against "remixes" is a length gap of
 * four and stays a miss no matter how generous the long word's own allowance
 * would have been.
 */
export function wordsMatch(a: string, b: string): boolean {
    if (a === b) return true;
    const allowance = allowanceFor(Math.min(a.length, b.length));
    if (allowance === 0) return false;
    if (Math.abs(a.length - b.length) > allowance) return false;
    return editDistance(a, b, allowance) <= allowance;
}

/** True when any word in `haystack` is `word` or a near-miss of it. */
export function someWordMatches(word: string, haystack: Iterable<string>): boolean {
    for (const candidate of haystack) {
        if (wordsMatch(word, candidate)) return true;
    }
    return false;
}
