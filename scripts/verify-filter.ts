// scripts/verify-filter.ts
//
// Proof that the results-page song filter (lib/songFilter.ts) narrows a list
// the way someone typing into it expects, run with:
//
//     node --experimental-strip-types scripts/verify-filter.ts
//
// Checked here rather than by eye because the failure mode is silent and
// symmetrical: a rule that is too loose returns the whole list (looks like
// the filter is broken) and a rule that is too tight returns nothing (looks
// like the song is missing). Neither throws, and both are one character of
// regex apart. The "Band C matched all twenty rows" case below is a real
// defect this script was written to pin down, not a hypothetical.

import { prepareSongQuery, songMatchesQuery, type FilterableSong } from "../lib/songFilter.ts";

let checks = 0;
const failures: string[] = [];

function check(label: string, actual: unknown, expected: unknown): void {
    checks += 1;
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) failures.push(`${label}\n    expected ${e}\n    actual   ${a}`);
}

const LIBRARY: FilterableSong[] = [
    { title: "Let It Go", artist: "Idina Menzel" },
    { title: "Don't Stop Me Now", artist: "Queen" },
    { title: "Sample Track 07", artist: "Band C" },
    { title: "Sample Track 08", artist: "Band D" },
    { title: "Café Del Mar", artist: "Energy 52" },
    { title: "99 Problems", artist: "JAY-Z" },
    { title: "Chicken Huntin'", artist: "Insane Clown Posse" },
];

function found(term: string): string[] {
    const q = prepareSongQuery(term);
    return LIBRARY.filter((s) => songMatchesQuery(s, q)).map((s) => s.title);
}

// --- the resting state ----------------------------------------------------
check("empty query keeps everything", found("").length, LIBRARY.length);
check("whitespace-only query keeps everything", found("   ").length, LIBRARY.length);

// --- ordinary narrowing ---------------------------------------------------
check("exact title", found("Let It Go"), ["Let It Go"]);
check("one word", found("stop"), ["Don't Stop Me Now"]);
check("by artist", found("queen"), ["Don't Stop Me Now"]);
check("word order does not matter", found("go let"), ["Let It Go"]);
check("title and artist together", found("let idina"), ["Let It Go"]);

// --- the defect this file exists for --------------------------------------
// "c" appears inside "track", so a per-token substring rule matched every
// Sample Track row -- and, being a substring rule, "Chicken" too.
check("short token does not match mid-word", found("band c"), ["Sample Track 07"]);
// A single letter falls back to rule 1 alone, since rule 2's floor excludes
// it. So it finds the songs with a word STARTING in "c" and not the ones that
// merely contain one -- "Sample Track 07" is here for its artist, Band C, and
// emphatically not for the "c" in "Track".
check("a bare short token only prefixes", found("c"), [
    "Sample Track 07",
    "Café Del Mar",
    "Chicken Huntin'",
]);


// --- punctuation the searcher does not reproduce --------------------------
check("apostrophe dropped by the searcher", found("dont stop"), ["Don't Stop Me Now"]);
check("apostrophe typed as written", found("don't stop"), ["Don't Stop Me Now"]);
check("diacritic dropped by the searcher", found("cafe"), ["Café Del Mar"]);
check("diacritic typed as written", found("café"), ["Café Del Mar"]);
check("hyphen in the artist", found("jay z"), ["99 Problems"]);
check("trailing apostrophe in the title", found("huntin"), ["Chicken Huntin'"]);

// --- fragments ------------------------------------------------------------
check("fragment starting mid-word", found("et it"), ["Let It Go"]);
check("digits", found("07"), ["Sample Track 07"]);
check("digits in a title that starts with them", found("99"), ["99 Problems"]);

// --- misses stay misses ---------------------------------------------------
check("nonsense matches nothing", found("zzzz"), []);
check("real word that is not there", found("thunderstruck"), []);
check("only one of two tokens present", found("let thunderstruck"), []);

// A filter is only useful if it actually removes rows: every single-word
// query above should leave the list strictly shorter than it started.
for (const term of ["stop", "queen", "cafe", "huntin", "07"]) {
    check(`"${term}" narrows the list`, found(term).length < LIBRARY.length, true);
}

if (failures.length > 0) {
    console.error(`\n${failures.length} of ${checks} checks FAILED:\n`);
    for (const f of failures) console.error(`  ${f}\n`);
    process.exit(1);
}
console.log(`\n${checks}/${checks} checks passed.`);
console.log("The results filter narrows on word starts, survives punctuation, and never answers \"all of them\".");
