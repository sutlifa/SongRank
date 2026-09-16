// scripts/verify-starters.ts
//
// Checks the ready-made lists in lib/starterLists.ts, run with:
//
//     node --experimental-strip-types scripts/verify-starters.ts
//
// These are hand-typed data, and every way they can be wrong is silent. A
// duplicated id makes one list unreachable behind another; a song repeated
// inside a list is silently dropped by NewTournament's own de-duplication, so
// the card promises 30 songs and the ranking has 29; a stray empty string
// becomes a song with no title that nothing can match. None of that throws,
// none of it shows up in a type check, and all of it is only visible to
// someone who counts the rows by hand.
//
// Exits non-zero on the first broken invariant, same contract as the other
// verify scripts.

import { CURATED_STARTERS, STARTER_CATEGORIES } from "../lib/starterLists.ts";
import { MAX_SONGS } from "../lib/swiss.ts";
import { ROUND_ROBIN_CEILING, estimateMatchups } from "../lib/ranking.ts";

let failures = 0;
function check(condition: boolean, message: string): void {
    if (!condition) {
        failures += 1;
        console.error(`FAIL: ${message}`);
    }
}

const seenIds = new Set<string>();
const categories = new Set<string>(STARTER_CATEGORIES);

console.log(`${CURATED_STARTERS.length} curated lists:\n`);

for (const list of CURATED_STARTERS) {
    const where = `"${list.id}"`;

    check(!seenIds.has(list.id), `${where}: duplicate id -- one of the two lists is unreachable`);
    seenIds.add(list.id);
    // The id goes in a URL and in links people share, so it has to survive
    // being typed and copied: lowercase, digits and hyphens only.
    check(/^[a-z0-9-]+$/.test(list.id), `${where}: id is not a clean URL slug`);
    check(list.title.trim().length > 0, `${where}: empty title`);
    check(list.blurb.trim().length > 0, `${where}: empty blurb`);
    check(list.emoji.trim().length > 0, `${where}: empty emoji`);
    check(categories.has(list.category), `${where}: unknown category "${list.category}"`);

    // Below ROUND_ROBIN_CEILING the engine just plays every pair, which is a
    // fine ranking but a thin offer for a card promising a session; and a list
    // over MAX_SONGS would be silently truncated on import.
    check(
        list.songs.length > ROUND_ROBIN_CEILING,
        `${where}: only ${list.songs.length} songs -- too small to be worth offering`
    );
    check(list.songs.length <= MAX_SONGS, `${where}: ${list.songs.length} songs exceeds MAX_SONGS`);

    const seenSongs = new Set<string>();
    for (const song of list.songs) {
        const label = `${where}: "${song.title}"`;
        check(song.title.trim().length > 0, `${where}: a song has an empty title`);
        check(song.artist.trim().length > 0, `${label} has an empty artist`);
        check(song.title === song.title.trim(), `${label} has leading or trailing whitespace`);
        check(song.artist === song.artist.trim(), `${label}: artist has leading or trailing whitespace`);

        // Same key NewTournament.addSongs de-duplicates on, so this catches
        // exactly the pairs it would silently drop.
        const key = `${song.title.toLowerCase()}|${song.artist.toLowerCase()}`;
        check(!seenSongs.has(key), `${label} by ${song.artist} appears twice in this list`);
        seenSongs.add(key);
    }

    // How top-heavy a list is with one artist. Not an error -- a Beatles list
    // is 100% Beatles by design -- but worth printing, because a genre list
    // that has drifted to a third one artist spends its most informative early
    // matchups inside a single discography.
    const byArtist = new Map<string, number>();
    for (const song of list.songs) {
        const key = song.artist.toLowerCase();
        byArtist.set(key, (byArtist.get(key) ?? 0) + 1);
    }
    const [topArtist, topCount] = [...byArtist.entries()].sort((a, b) => b[1] - a[1])[0];
    const share = Math.round((topCount / list.songs.length) * 100);

    console.log(
        `  ${list.id.padEnd(18)} ${String(list.songs.length).padStart(3)} songs  ` +
            `~${String(estimateMatchups(list.songs.length, "thorough")).padStart(4)} matchups  ` +
            `${byArtist.size} artists, most common ${share}% (${topArtist})`
    );
}

// Every category needs at least one list, or the browse page renders a heading
// with nothing under it -- caught here rather than by someone noticing a gap.
for (const category of STARTER_CATEGORIES) {
    // "featured" is the one that may legitimately be thin, since the live
    // chart joins it at runtime; it still needs a fixed list of its own so the
    // section is never empty when the feed is down.
    check(
        CURATED_STARTERS.some((l) => l.category === category),
        `category "${category}" has no curated list -- its section would render empty`
    );
}

const totalSongs = CURATED_STARTERS.reduce((sum, l) => sum + l.songs.length, 0);
console.log(`\n${totalSongs} songs across ${CURATED_STARTERS.length} lists.`);

if (failures > 0) {
    console.error(`\n${failures} failure(s).`);
    process.exit(1);
}
console.log("All starter lists are well formed.");
