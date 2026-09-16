// scripts/verify-compare.ts
//
// Proof for lib/compare.ts, run with:
//
//     node --experimental-strip-types scripts/verify-compare.ts
//
// Comparing two rankings is the one piece of this feature that can be wrong
// without anything failing: a mis-matched song pair produces a page of
// confident, plausible numbers that simply aren't about the songs it names.
// So the matching rules and the correlation are checked by construction here
// rather than by looking at a rendered page and nodding.

import { compareRankings, describeCorrelation, type CompareEntry } from "../lib/compare.ts";

let failures = 0;
function check(condition: boolean, message: string): void {
    if (!condition) {
        failures += 1;
        console.error(`FAIL: ${message}`);
    }
}

/** Builds a ranking from "Title|Artist" strings, ranked in the order given.
 * `ids` overrides the song ids, which is how the id-vs-text matching rules are
 * exercised separately. */
function ranking(entries: string[], ids?: string[]): CompareEntry[] {
    return entries.map((entry, i) => {
        const [title, artist] = entry.split("|");
        return { songId: ids?.[i] ?? `id-${title}`, title, artist: artist ?? "Artist", rank: i + 1 };
    });
}

console.log("Identical rankings:");
{
    const a = ranking(["A|X", "B|X", "C|X", "D|X"]);
    const c = compareRankings(a, a);
    check(c.correlation === 1, `identical rankings should correlate 1, got ${c.correlation}`);
    check(c.shared.length === 4, "identical rankings should share every song");
    check(c.agreements === 4, "identical rankings should agree on every placing");
    check(c.biggestDisagreements.length === 0, "identical rankings should have no disagreements");
    check(c.onlyMine.length === 0 && c.onlyTheirs.length === 0, "identical rankings should have no exclusives");
    console.log(`  correlation ${c.correlation}, ${c.agreements}/4 exact -- "${describeCorrelation(c.correlation)}"`);
}

console.log("\nExactly reversed:");
{
    const a = ranking(["A|X", "B|X", "C|X", "D|X"]);
    const b = ranking(["D|X", "C|X", "B|X", "A|X"]);
    const c = compareRankings(a, b);
    check(c.correlation === -1, `reversed rankings should correlate -1, got ${c.correlation}`);
    check(c.shared.length === 4, "reversed rankings still share every song");
    check(c.agreements === 0, "reversed rankings agree on nothing (even length)");
    // #1 vs #4 is three places; the extremes must be the loudest disagreement.
    check(Math.abs(c.biggestDisagreements[0].delta) === 3, "the extremes should be the biggest disagreement");
    console.log(`  correlation ${c.correlation} -- "${describeCorrelation(c.correlation)}"`);
}

console.log("\nMatching by song id, when the text has diverged:");
{
    // The "Change version" case: same song id on both sides, but one person
    // swapped to a live recording so the title and artist text differ. Text
    // matching alone would drop this song from the comparison entirely.
    const mine = ranking(["Let It Go|Idina Menzel", "Frozen Heart|Cast"], ["song-1", "song-2"]);
    const theirs = ranking(["Let It Go (Live)|Demi Lovato", "Frozen Heart|Cast"], ["song-1", "song-2"]);
    const c = compareRankings(mine, theirs);
    check(c.shared.length === 2, `id matching should hold both songs together, got ${c.shared.length}`);
    check(c.onlyMine.length === 0 && c.onlyTheirs.length === 0, "nothing should be exclusive here");
    console.log(`  2 songs, titles differ on one, still ${c.shared.length} shared`);
}

console.log("\nMatching by text, when the ids are unrelated:");
{
    // Two people who built their lists independently: no id can ever line up,
    // so the fallback is the only thing that can pair these.
    const mine = ranking(["Africa|TOTO", "Hey Jude|The Beatles"], ["mine-1", "mine-2"]);
    const theirs = ranking(["  hey jude |  the beatles ", "africa|toto"], ["theirs-1", "theirs-2"]);
    const c = compareRankings(mine, theirs);
    check(c.shared.length === 2, `text matching should pair both songs, got ${c.shared.length}`);
    const africa = c.shared.find((s) => s.title === "Africa")!;
    check(africa.mine === 1 && africa.theirs === 2, "Africa should be 1st for me and 2nd for them");
    check(c.correlation === -1, `two songs in opposite order correlate -1, got ${c.correlation}`);
    console.log(`  case and whitespace differences still matched; correlation ${c.correlation}`);
}

console.log("\nId matches are never overwritten by a looser text match:");
{
    // Both of mine carry ids that exist on their side, but the TEXT of my
    // first song matches their second. If pass 2 could override pass 1, "A"
    // would end up paired with the wrong entry.
    const mine = ranking(["A|X", "B|X"], ["s1", "s2"]);
    const theirs: CompareEntry[] = [
        { songId: "s2", title: "B", artist: "X", rank: 1 },
        { songId: "s1", title: "A", artist: "X", rank: 2 },
    ];
    const c = compareRankings(mine, theirs);
    const a = c.shared.find((s) => s.title === "A")!;
    check(a.mine === 1 && a.theirs === 2, "A must pair with the entry sharing its id, at their rank 2");
    check(c.shared.length === 2, "both songs should still be shared");
    console.log(`  A: mine #${a.mine}, theirs #${a.theirs} -- paired by id, not by text`);
}

console.log("\nPartial overlap:");
{
    const mine = ranking(["A|X", "B|X", "C|X", "D|X"]);
    const theirs = ranking(["C|X", "B|X", "E|X"]);
    const c = compareRankings(mine, theirs);
    check(c.shared.length === 2, `only B and C are shared, got ${c.shared.length}`);
    check(c.onlyMine.join(",") === "A,D", `onlyMine should be A,D -- got ${c.onlyMine.join(",")}`);
    check(c.onlyTheirs.join(",") === "E", `onlyTheirs should be E -- got ${c.onlyTheirs.join(",")}`);

    // The re-ranking rule: within the shared set B is 1st and C 2nd for me,
    // and C is 1st and B 2nd for them -- NOT their original 2/3 and 1/2.
    const b = c.shared.find((s) => s.title === "B")!;
    const cc = c.shared.find((s) => s.title === "C")!;
    check(b.mine === 1 && b.theirs === 2, `B should be shared-rank 1 vs 2, got ${b.mine} vs ${b.theirs}`);
    check(cc.mine === 2 && cc.theirs === 1, `C should be shared-rank 2 vs 1, got ${cc.mine} vs ${cc.theirs}`);
    check(c.correlation === -1, `two shared songs in opposite order correlate -1, got ${c.correlation}`);
    console.log(`  4 vs 3 songs -> ${c.shared.length} shared, ranks renumbered within the overlap`);
}

console.log("\nDegenerate cases:");
{
    const none = compareRankings(ranking(["A|X"]), ranking(["B|Y"]));
    check(none.shared.length === 0, "no overlap should share nothing");
    check(none.correlation === null, "no overlap has no correlation");
    check(
        describeCorrelation(null) === "Not enough songs in common to compare.",
        "a null correlation must not be described as agreement"
    );

    const one = compareRankings(ranking(["A|X"]), ranking(["A|X"]));
    check(one.shared.length === 1, "one shared song should still be reported as shared");
    check(
        one.correlation === null,
        `a single shared song has no meaningful correlation, got ${one.correlation}`
    );

    const empty = compareRankings([], []);
    check(empty.shared.length === 0 && empty.correlation === null, "two empty rankings should not throw");
    console.log("  no overlap, single overlap and empty rankings all handled without a fake 1.0");
}

console.log("\nA song is never paired twice:");
{
    // Their list contains the same title twice (an old row could). Mine has it
    // once. Exactly one pairing must result, and the duplicate must show up
    // honestly as theirs-only rather than silently vanishing.
    const mine = ranking(["A|X"], ["m1"]);
    const theirs: CompareEntry[] = [
        { songId: "t1", title: "A", artist: "X", rank: 1 },
        { songId: "t2", title: "A", artist: "X", rank: 2 },
    ];
    const c = compareRankings(mine, theirs);
    check(c.shared.length === 1, `one of mine can only pair once, got ${c.shared.length}`);
    check(c.onlyTheirs.length === 1, `their duplicate should be reported unmatched, got ${c.onlyTheirs.length}`);
    console.log(`  duplicate on one side: ${c.shared.length} shared, ${c.onlyTheirs.length} unmatched`);
}

console.log("\nCorrelation bands are ordered and total:");
{
    // Every value from -1 to 1 must get a description, and the wording must
    // not claim agreement for a negative correlation.
    for (let v = -100; v <= 100; v += 1) {
        const text = describeCorrelation(v / 100);
        check(text.length > 0, `no description for correlation ${v / 100}`);
        if (v / 100 <= -0.4) {
            check(text.includes("opposite"), `correlation ${v / 100} should read as opposite taste`);
        }
        if (v / 100 >= 0.9) {
            check(text.includes("identical"), `correlation ${v / 100} should read as identical taste`);
        }
    }
    console.log("  every correlation from -1.00 to 1.00 has a description, and the extremes read correctly");
}

if (failures > 0) {
    console.error(`\n${failures} failure(s).`);
    process.exit(1);
}
console.log("\nAll comparison invariants hold.");
