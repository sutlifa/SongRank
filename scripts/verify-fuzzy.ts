// scripts/verify-fuzzy.ts
//
// Proof that the "close enough" word matching in lib/fuzzy.ts forgives real
// misspellings without quietly accepting different words, run with:
//
//     node --experimental-strip-types scripts/verify-fuzzy.ts
//
// This needs testing far more than it looks like it does. A fuzzy matcher
// never throws; it is either too mean (the bug it was written to fix is
// still there and nobody can tell, because a missing search result looks
// exactly like a catalogue that doesn't have the song) or too generous (a
// wrong recording lands in somebody's ranking, which is worse, and worse
// still because they may not notice until they hear it). Both failures are
// invisible from the outside, so both are pinned down here.

import { editDistance, wordsMatch, someWordMatches } from "../lib/fuzzy.ts";
import { scoreCandidate } from "../lib/itunes.ts";

let checks = 0;
const failures: string[] = [];

function check(label: string, actual: unknown, expected: unknown): void {
    checks += 1;
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) failures.push(`${label}\n    expected ${e}\n    actual   ${a}`);
}

// --- editDistance ---------------------------------------------------------
check("identical", editDistance("chicken", "chicken"), 0);
check("one substitution", editDistance("chicken", "chickin"), 1);
check("one deletion", editDistance("huntin", "hutin"), 1);
check("one insertion", editDistance("mix", "mixe"), 1);
check("transposition counts once", editDistance("beleive", "believe"), 1);
check("two unrelated errors", editDistance("believe", "bilyeve"), 2);
check("empty against a word", editDistance("", "song"), 4);
check("word against empty", editDistance("song", ""), 4);
check("nothing in common", editDistance("cat", "dog"), 3);

// The cutoff must never change an answer that was already within it, and must
// report *something over* the cutoff otherwise -- callers only ever compare
// against the cutoff, so the exact overshoot is not promised.
check("cutoff does not alter an in-range answer", editDistance("chicken", "chickin", 2), 1);
check("cutoff reports over-range as over-range", editDistance("cat", "dog", 1) > 1, true);
check("length gap alone exceeds a small cutoff", editDistance("mix", "remixes", 1) > 1, true);

// --- wordsMatch: the rescues ---------------------------------------------
// The case this whole module exists for.
check("chicken/chickin", wordsMatch("chicken", "chickin"), true);
check("transposed typo", wordsMatch("beleive", "believe"), true);
check("dropped letter", wordsMatch("rhythm", "rythm"), true);
check("dropped one of a doubled letter", wordsMatch("running", "runing"), true);
check("long word, one error", wordsMatch("unforgettable", "unforgetable"), true);
// Two edits in an eight-letter word is over its allowance, and stays over it
// even though "tommorow" is a misspelling a person really does make. That is
// the conservative side of the trade the thresholds take deliberately: see
// allowanceFor in lib/fuzzy.ts. Recorded here so that moving the boundary is
// a decision someone makes on purpose rather than a test quietly going green.
check("two errors in an eight-letter word", wordsMatch("tomorrow", "tommorow"), false);

// --- wordsMatch: the refusals --------------------------------------------
// Short words get no latitude at all: one edit apart is usually a different
// word, and songs are full of them.
check("love/live stay different", wordsMatch("love", "live"), false);
check("fire/fine stay different", wordsMatch("fire", "fine"), false);
check("mine/nine stay different", wordsMatch("mine", "nine"), false);
check("cat/dog", wordsMatch("cat", "dog"), false);
// A short word must not be stretched to reach a long one.
check("mix does not reach remixes", wordsMatch("mix", "remixes"), false);
check("go does not reach gone", wordsMatch("go", "gone"), false);
// Two errors is too many for a mid-length word.
check("mid-length word, two errors", wordsMatch("huntin", "hantan"), false);
check("unrelated long words", wordsMatch("slaughter", "pluckin"), false);

// --- someWordMatches ------------------------------------------------------
check("finds a near-miss in a set", someWordMatches("chicken", new Set(["chickin", "huntin"])), true);
check("finds an exact hit in a set", someWordMatches("huntin", new Set(["chickin", "huntin"])), true);
check("reports a genuine absence", someWordMatches("banjo", new Set(["chickin", "huntin"])), false);
check("empty haystack", someWordMatches("chicken", new Set<string>()), false);

// --- end to end, through the scorer that actually gates results ----------
// The user-reported case, in the form it really arrived: Apple files the
// track under a differently-spelled title, and our own scoring -- not Apple
// -- was what demoted it.
//
// Asserted as "high" specifically, and NOT as the weaker "not none" it is
// tempting to write. Under exact matching this pair already scored "partial":
// of the two title tokens, "huntin" matched and only "chicken" missed, for a
// coverage of 0.5, which clears the 0.4 partial bar on its own. A "not none"
// assertion therefore passes with fuzzy matching removed entirely -- it was
// written that way first, and proved exactly nothing. What fuzzy matching
// actually buys is the other half: "chicken" reaching "chickin" takes
// coverage to 1.0 and the match to "high". Only that distinction bites, and
// "high" is what matters downstream anyway -- resolveSong ranks by
// confidence, and the pre-flight screen treats "partial" as needing
// suggestions, the same as a flat miss.
const icp = scoreCandidate(
    { title: "Chicken Huntin'", artist: "Insane Clown Posse" },
    { title: 'Chickin "Pluckin" Huntin Remix', artist: "Insane Clown Posse" }
);
check("the reported miss is now a confident match", icp, "high");

// ...while a genuinely different song by the same artist still does not pass
// as a title match. Same artist, so the artist half scores full marks; the
// title has to be what keeps this off "high".
const wrongTrack = scoreCandidate(
    { title: "Chicken Huntin'", artist: "Insane Clown Posse" },
    { title: "Halls of Illusions", artist: "Insane Clown Posse" }
);
check("a different track by the same artist is not a high match", wrongTrack === "high", false);

// A cover by somebody else must not be promoted to "high" either.
const cover = scoreCandidate(
    { title: "Chicken Huntin'", artist: "Insane Clown Posse" },
    { title: "Chicken Huntin'", artist: "Some Tribute Band" }
);
check("a cover is not a high match", cover === "high", false);

// The ordinary exact case must be untouched by all of this.
check(
    "an exact match is still high",
    scoreCandidate(
        { title: "Let It Go", artist: "Idina Menzel" },
        { title: "Let It Go", artist: "Idina Menzel" }
    ),
    "high"
);

if (failures.length > 0) {
    console.error(`\n${failures.length} of ${checks} checks FAILED:\n`);
    for (const f of failures) console.error(`  ${f}\n`);
    process.exit(1);
}
console.log(`\n${checks}/${checks} checks passed.`);
console.log("Misspellings are forgiven, different words are not, and the reported miss now scores.");
