// scripts/verify-spotify-cache.ts
//
// Proof that a Spotify search is never paid for twice, run against a LOCAL
// database with:
//
//     DATABASE_URL=postgresql://...localhost... node --experimental-strip-types scripts/verify-spotify-cache.ts
//
// Why this exists. Spotify meters search PER APPLICATION, and an app in
// development mode gets an allowance small enough that a two-hundred-song
// ranking exhausts it and is then locked out for a good while. Under that
// constraint a search result is not a cheap thing to re-fetch; it is the
// scarcest resource the feature has. Exporting the same ranking twice used to
// cost twice, so a person who came back after a lockout re-paid for the songs
// already done, hit the wall in the same place, and never advanced.
//
// The cache is what makes coming back cheap, and the only thing that would
// make it worse than useless is handing back the WRONG track. So both halves
// are checked: that an answer is remembered, and that it is remembered against
// the right song.
//
// Refuses to run against anything but localhost, same as verify-nodataloss.ts:
// it writes and deletes rows.

import { sql } from "../lib/db.ts";
import { getCachedSpotifyMatches, saveCachedSpotifyMatches } from "../lib/queries.ts";
import { cacheKey } from "../lib/spotify.ts";

const url = process.env.DATABASE_URL ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
    console.error("Refusing to run: DATABASE_URL is not a local database.");
    process.exit(1);
}

let checks = 0;
const failures: string[] = [];
function check(label: string, actual: unknown, expected: unknown): void {
    checks += 1;
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) failures.push(`${label}\n    expected ${e}\n    actual   ${a}`);
}

// Titles nobody will ever have in a real ranking, so this suite can clean up
// after itself by prefix without touching anything it did not create.
const PREFIX = "zzverifycache";
const clean = () => sql`DELETE FROM spotify_track_matches WHERE title_key LIKE ${`${PREFIX}%`}`;
await clean();

const key = (title: string, artist: string) => cacheKey(`${PREFIX} ${title}`, artist);
const look = async (title: string, artist: string) => {
    const found = await getCachedSpotifyMatches([key(title, artist)]);
    const k = key(title, artist);
    return found.get(`${k.titleKey}\u0000${k.artistKey}`) ?? null;
};
const remember = (title: string, artist: string, uri: string | null, confidence: "high" | "partial" | "none") =>
    saveCachedSpotifyMatches([
        {
            ...key(title, artist),
            uri,
            title: uri ? `${title} (Spotify)` : null,
            artist: uri ? artist : null,
            album: uri ? "An Album" : null,
            confidence,
        },
    ]);

// --- an answer is remembered ---------------------------------------------

check("a song nobody has looked up is absent", await look("Never Asked", "Nobody"), null);

await remember("Found Song", "Some Artist", "spotify:track:aaaaaaaaaaaaaaaaaaaaaa", "high");
const hit = await look("Found Song", "Some Artist");
check("a hit comes back", hit?.uri, "spotify:track:aaaaaaaaaaaaaaaaaaaaaa");
check("...with the recording it matched, not the pasted text", hit?.title, "Found Song (Spotify)");
check("...and how sure we were", hit?.confidence, "high");

// A MISS is the one most worth storing and the easiest to forget to store:
// learning "Spotify does not have this" costs exactly the same request as
// learning it does, and re-learning it costs another.
await remember("Missing Song", "Some Artist", null, "none");
const miss = await look("Missing Song", "Some Artist");
check("a miss is remembered as a miss, not as absent", miss !== null, true);
check("...and carries no track", miss?.uri, null);

// --- remembered against the RIGHT song ------------------------------------
//
// The key is the song, not the way one ranking happened to credit it, so a
// soundtrack song cached from a seven-name credit is found by a list that
// names one singer. Cross-user by design: this is public catalogue data, so
// one person's export makes the next person's free.
await remember("Shared Song", "Idina Menzel, Kristen Anderson-Lopez & Robert Lopez", "spotify:track:bbbbbbbbbbbbbbbbbbbbbb", "high");
check(
    "the same song under a shorter credit finds the same answer",
    (await look("Shared Song", "Idina Menzel"))?.uri,
    "spotify:track:bbbbbbbbbbbbbbbbbbbbbb"
);
// The failure that would matter: a DIFFERENT song silently inheriting it.
check("a different artist does not inherit the answer", await look("Shared Song", "Someone Else"), null);
check("a different title does not inherit the answer", await look("Shared Other", "Idina Menzel"), null);

// --- a miss can become a hit ----------------------------------------------
//
// Spotify's catalogue really does gain tracks, so "not there" is only true as
// of when it was asked. A re-check must be able to overwrite the miss --
// insert-if-absent would pin the wrong answer forever.
await remember("Missing Song", "Some Artist", "spotify:track:cccccccccccccccccccccc", "high");
check("a miss that later resolves is upgraded", (await look("Missing Song", "Some Artist"))?.uri, "spotify:track:cccccccccccccccccccccc");
check("...and its confidence is updated too", (await look("Missing Song", "Some Artist"))?.confidence, "high");

// --- what expires, and what does not --------------------------------------
//
// Misses age out so a newly added track turns up eventually. Hits do not: a
// track that exists keeps existing, and re-checking it spends the exact
// resource this table exists to protect.
await remember("Stale Miss", "Old Artist", null, "none");
const staleKey = key("Stale Miss", "Old Artist");
await sql`
    UPDATE spotify_track_matches SET checked_at = now() - interval '60 days'
    WHERE title_key = ${staleKey.titleKey} AND artist_key = ${staleKey.artistKey}
`;
check("a miss older than the TTL is asked again", await look("Stale Miss", "Old Artist"), null);

await remember("Old Hit", "Old Artist", "spotify:track:dddddddddddddddddddddd", "high");
const oldKey = key("Old Hit", "Old Artist");
await sql`
    UPDATE spotify_track_matches SET checked_at = now() - interval '900 days'
    WHERE title_key = ${oldKey.titleKey} AND artist_key = ${oldKey.artistKey}
`;
check("an old HIT is still trusted, however old", (await look("Old Hit", "Old Artist"))?.uri, "spotify:track:dddddddddddddddddddddd");

// --- the batch shape the route actually uses ------------------------------
//
// The route asks about a whole slice in ONE query. If that read were per-song
// it would just move the cost from Spotify to Postgres, and a partly-cached
// slice has to come back correctly split -- known songs present, unknown ones
// absent -- or the route searches for things it already knows.
const batch = await getCachedSpotifyMatches([
    key("Found Song", "Some Artist"),
    key("Never Asked", "Nobody"),
    key("Old Hit", "Old Artist"),
    key("Stale Miss", "Old Artist"),
]);
check("a batch returns exactly the songs it knows", batch.size, 2);
const known = (title: string, artist: string) => {
    const k = key(title, artist);
    return batch.has(`${k.titleKey}\u0000${k.artistKey}`);
};
check("...the hit is in it", known("Found Song", "Some Artist"), true);
check("...the old hit is in it", known("Old Hit", "Old Artist"), true);
check("...the unknown song is not", known("Never Asked", "Nobody"), false);
check("...and neither is the stale miss", known("Stale Miss", "Old Artist"), false);

check("asking about nothing is not a query", (await getCachedSpotifyMatches([])).size, 0);
// Saving nothing must not be a malformed INSERT with no rows.
await saveCachedSpotifyMatches([]);
check("saving nothing is a no-op, not an error", true, true);

// A song with no artist at all is a real case: a pasted list of bare titles.
await remember("Bare Title", "", "spotify:track:eeeeeeeeeeeeeeeeeeeeee", "partial");
check("a song with no credited artist round-trips", (await look("Bare Title", ""))?.uri, "spotify:track:eeeeeeeeeeeeeeeeeeeeee");

await clean();
await sql.end();

if (failures.length > 0) {
    console.error(`\n${failures.length} of ${checks} checks FAILED:\n`);
    for (const f of failures) console.error(`  ${f}\n`);
    process.exit(1);
}
console.log(`\n${checks}/${checks} checks passed.`);
console.log("Every answer is remembered, misses included, against the song and not the credit.");
