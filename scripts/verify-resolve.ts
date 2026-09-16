// scripts/verify-resolve.ts
//
// Headless proof that lib/itunes.ts's resolution cascade (problem A) does
// what the brief asked for, run with:
//
//     node --experimental-strip-types scripts/verify-resolve.ts
//
// itunes.apple.com is blocked by this sandbox's proxy (verified: 403 on
// CONNECT -- see AGENTS.md / CLAUDE.md), so none of this can hit the real
// API. Instead it checks the two things that don't need a network call:
//
//   1. `primaryArtist` / `buildResolveQueries` produce sane, narrow queries
//      for the real problem lines from the brief -- ensemble credits,
//      "featuring", "&", parenthetical titles, generic "Cast"/"Chorus"
//      credits, and the asterisk/apostrophe cases ("4*TOWN", "*NSYNC",
//      "Auli'i Cravalho", "Keali'i Ho'omalu") -- without ever calling
//      `fetch`.
//   2. `resolveSong` and `suggestMatches`, driven against a small mocked
//      catalogue via a monkey-patched `fetch`, actually walk the cascade:
//      a query that only the catalogue's *narrowed* form would find still
//      resolves, a query that finds nothing at any narrowing stays null,
//      and the cascade stops escalating once a high-confidence hit turns
//      up (bounding the request count a real run would make).
//
// Not a test framework: exits non-zero on the first failed assertion and
// prints what broke, same shape as scripts/verify-parse.ts.

import { primaryArtist, buildResolveQueries, scoreCandidate, resolveSong, suggestMatches } from "../lib/itunes.ts";

let failures = 0;
let checks = 0;

function check(name: string, cond: boolean, detail?: string) {
    checks++;
    if (!cond) {
        failures++;
        console.error(`FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
    }
}

// ---------------------------------------------------------------------------
// 1. primaryArtist -- the "first credited performer" extraction the whole
//    cascade depends on.
// ---------------------------------------------------------------------------

{
    check(
        "primaryArtist: seven-way ensemble credit -> first performer only",
        primaryArtist("Carolina Gaitan, Mauro Castillo, Adassa, Rhenzy Feliz, Diane Guerrero, Stephanie Beatriz & Encanto Cast") ===
            "Carolina Gaitan"
    );
    check(
        "primaryArtist: two leads + cast credit -> first name only",
        primaryArtist("Jerry Orbach, Angela Lansbury & Beauty and the Beast Cast") === "Jerry Orbach"
    );
    check("primaryArtist: 'featuring' split", primaryArtist("Miguel featuring Natalia Lafourcade") === "Miguel");
    check("primaryArtist: '&' split", primaryArtist("Auli'i Cravalho & Rachel House") === "Auli'i Cravalho", primaryArtist("Auli'i Cravalho & Rachel House"));
    check("primaryArtist: apostrophe preserved, not stripped", primaryArtist("Auli'i Cravalho & Rachel House").includes("'"));
    check(
        "primaryArtist: no separator -> whole string is the primary (generic credit, handled separately)",
        primaryArtist("The Dwarf Chorus") === "The Dwarf Chorus"
    );
    check("primaryArtist: 'The Muses' has no split point either", primaryArtist("The Muses") === "The Muses");
    check("primaryArtist: '&' before an asterisked group name", primaryArtist("Phil Collins & *NSYNC") === "Phil Collins");
    check(
        "primaryArtist: apostrophes in a multi-name credit don't confuse the split",
        primaryArtist("Mark Keali'i Ho'omalu & Kamehameha Schools Children's Chorus") === "Mark Keali'i Ho'omalu"
    );
    check("primaryArtist: asterisk-only artist string passes through untouched", primaryArtist("4*TOWN") === "4*TOWN");
    check("primaryArtist: empty artist -> empty string, not a throw", primaryArtist("") === "");
}

// ---------------------------------------------------------------------------
// 2. buildResolveQueries -- the actual ladder of search terms.
// ---------------------------------------------------------------------------

{
    const qs = buildResolveQueries(
        "We Don't Talk About Bruno",
        "Carolina Gaitan, Mauro Castillo, Adassa, Rhenzy Feliz, Diane Guerrero, Stephanie Beatriz & Encanto Cast"
    );
    check("bruno: first query pairs the title with the primary artist only", qs[0] === "We Don't Talk About Bruno Carolina Gaitan");
    check("bruno: no query ever carries the full seven-name credit", qs.every((q) => !q.includes("Encanto Cast")));
    check("bruno: a title-only query exists as a fallback", qs.includes("We Don't Talk About Bruno"));
    check("bruno: query count stays small (a bounded cascade, not a combinatorial one)", qs.length <= 4, `got ${qs.length}: ${JSON.stringify(qs)}`);
}

{
    const qs = buildResolveQueries("Be Our Guest", "Jerry Orbach, Angela Lansbury & Beauty and the Beast Cast");
    check("be our guest: primary-artist query first", qs[0] === "Be Our Guest Jerry Orbach");
    check("be our guest: never queries with 'Cast' in it", qs.every((q) => !/cast/i.test(q)));
}

{
    const qs = buildResolveQueries("I'm Still Here (Jim's Theme)", "John Rzeznik");
    check("parenthetical title: raw title + artist tried first", qs[0] === "I'm Still Here (Jim's Theme) John Rzeznik");
    check("parenthetical title: stripped title + artist is also tried", qs.includes("I'm Still Here John Rzeznik"));
    check("parenthetical title: stripped title alone is also tried", qs.includes("I'm Still Here"));
    check("parenthetical title: apostrophes survive stripping intact", qs.some((q) => q.startsWith("I'm Still Here")));
}

{
    const qs = buildResolveQueries("I Am Moana (Song of the Ancestors)", "Auli'i Cravalho & Rachel House");
    check("moana: primary artist used, not the duet partner", qs[0] === "I Am Moana (Song of the Ancestors) Auli'i Cravalho");
    check("moana: stripped-title variant present", qs.includes("I Am Moana Auli'i Cravalho"));
    check("moana: never queries with 'Rachel House' in it (that's not the primary)", qs.every((q) => !q.includes("Rachel House")));
}

{
    const qs = buildResolveQueries("Remember Me", "Miguel featuring Natalia Lafourcade");
    check("remember me: 'featuring' clause dropped from the primary-artist query", qs[0] === "Remember Me Miguel");
    check("remember me: full featuring string never sent verbatim", qs.every((q) => !/featuring/i.test(q)));
}

{
    // Generic credits: "Heigh-Ho" / "The Dwarf Chorus" and "Zero to Hero" /
    // "The Muses" have no non-generic segment to fall back to, so per the
    // brief's step 4 these should skip straight to title-only queries rather
    // than wasting a request on "Heigh-Ho The Dwarf Chorus".
    const heighHo = buildResolveQueries("Heigh-Ho", "The Dwarf Chorus");
    check("Heigh-Ho: no query pairs the title with the generic 'Chorus' credit", heighHo.every((q) => !/chorus/i.test(q)));
    check("Heigh-Ho: falls back to a title-only query", heighHo.includes("Heigh-Ho"));

    const zero = buildResolveQueries("Zero to Hero", "The Muses");
    check("Zero to Hero: no query pairs the title with the generic 'Muses' credit", zero.every((q) => !/muses/i.test(q)));
    check("Zero to Hero: falls back to a title-only query", zero.includes("Zero to Hero"));
}

{
    // A generic primary credit *with* a distinctive later token: the
    // optional step 4 in the brief should surface it as an extra query.
    const qs = buildResolveQueries(
        "Hawaiian Roller Coaster Ride",
        "Mark Keali'i Ho'omalu & Kamehameha Schools Children's Chorus"
    );
    check(
        "roller coaster ride: primary is a real person, not generic, so it's used directly",
        qs[0] === "Hawaiian Roller Coaster Ride Mark Keali'i Ho'omalu"
    );
}

{
    const qs = buildResolveQueries("Trashin' the Camp", "Phil Collins & *NSYNC");
    check("trashin' the camp: primary-artist query keeps the apostrophe in the title", qs[0].startsWith("Trashin' the Camp"));
    check("trashin' the camp: the asterisked group name is never the primary query artist", qs[0] === "Trashin' the Camp Phil Collins");
}

{
    const qs = buildResolveQueries("Nobody Like U", "4*TOWN");
    check("4*TOWN: asterisk survives into the query untouched (nothing strips or escapes it)", qs.some((q) => q.includes("4*TOWN")));
}

// ---------------------------------------------------------------------------
// 3. scoreCandidate -- the confidence the cascade keeps and callers rely on.
// ---------------------------------------------------------------------------

{
    const high = scoreCandidate(
        { title: "We Don't Talk About Bruno", artist: "Carolina Gaitan, Mauro Castillo, Adassa, Rhenzy Feliz, Diane Guerrero, Stephanie Beatriz & Encanto Cast" },
        { title: "We Don't Talk About Bruno", artist: "Carolina Gaitan" }
    );
    check("scoreCandidate: exact title + primary-only candidate artist -> high", high === "high");

    const none = scoreCandidate({ title: "We Don't Talk About Bruno", artist: "Encanto Cast" }, { title: "Some Totally Different Song", artist: "Someone Else" });
    check("scoreCandidate: unrelated title/artist -> none", none === "none");

    const partial = scoreCandidate(
        { title: "Heigh-Ho", artist: "The Dwarf Chorus" },
        { title: "Heigh-Ho (The Dwarfs' Marching Song)", artist: "Adriana Caselotti" }
    );
    check("scoreCandidate: title-only overlap with a mismatched artist -> at least partial", partial === "partial" || partial === "high");
}

// ---------------------------------------------------------------------------
// 4. resolveSong / suggestMatches against a mocked `fetch` -- proves the
//    cascade actually escalates (and stops escalating) rather than just
//    building the right query strings and never using them.
// ---------------------------------------------------------------------------

interface MockCatalogueEntry {
    trackName: string;
    artistName: string;
    previewUrl?: string;
}

/** A tiny fake iTunes catalogue, keyed by exact query string -- only responds to queries the cascade is expected to actually send. */
function installMockFetch(catalogue: Record<string, MockCatalogueEntry[]>, calls: string[]) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        const params = new URL(url).searchParams;
        const term = decodeURIComponent(params.get("term") ?? "");
        calls.push(term);
        // The mock honours `limit`, because the real API does. Without this a
        // test could "prove" that a track buried 13 hits deep is found while
        // the code only ever asked for the top 5 -- the mock would hand back
        // the whole array regardless and the assertion would pass for the
        // wrong reason.
        const limit = Number(params.get("limit")) || 50;
        const results = (catalogue[term] ?? []).slice(0, limit);
        return new Response(JSON.stringify({ results }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    return () => {
        globalThis.fetch = originalFetch;
    };
}

async function runAsyncChecks() {
    // (a) A query the *old* `${title} ${artist}` code would have sent finds
    // nothing; only the narrowed, primary-artist query does. resolveSong
    // must still come back with a match.
    {
        const calls: string[] = [];
        const restore = installMockFetch(
            {
                "We Don't Talk About Bruno Carolina Gaitan": [
                    { trackName: "We Don't Talk About Bruno", artistName: "Carolina Gaitan, Mauro Castillo, Adassa, Rhenzy Feliz, Diane Guerrero, Stephanie Beatriz, Encanto - Cast" },
                ],
            },
            calls
        );
        try {
            const resolved = await resolveSong(
                "We Don't Talk About Bruno",
                "Carolina Gaitan, Mauro Castillo, Adassa, Rhenzy Feliz, Diane Guerrero, Stephanie Beatriz & Encanto Cast"
            );
            check("resolveSong: bruno resolves via the narrowed query", resolved.match !== null && resolved.confidence !== "none");
            check("resolveSong: bruno stops after the first (winning) query -- doesn't fan out further", calls.length === 1, `made ${calls.length} calls: ${JSON.stringify(calls)}`);
            check(
                "resolveSong: never sent the huge original artist string as a query",
                calls.every((c) => !c.includes("Rhenzy Feliz"))
            );
        } finally {
            restore();
        }
    }

    // (b) The primary-artist query finds nothing; the title-only fallback
    // (escalation) is what actually resolves it.
    {
        const calls: string[] = [];
        const restore = installMockFetch(
            {
                "Heigh-Ho": [{ trackName: "Heigh-Ho (The Dwarfs' Marching Song)", artistName: "Adriana Caselotti" }],
            },
            calls
        );
        try {
            const resolved = await resolveSong("Heigh-Ho", "The Dwarf Chorus");
            check("resolveSong: Heigh-Ho resolves via the title-only fallback (generic credit skipped)", resolved.match !== null);
            check("resolveSong: never queried with the generic 'Chorus' credit", calls.every((c) => !/chorus/i.test(c)));
        } finally {
            restore();
        }
    }

    // (c) Nothing in the mock catalogue answers any query in the cascade:
    // resolveSong must degrade to null, not throw, and must have tried more
    // than one query before giving up (proof it actually escalated).
    {
        const calls: string[] = [];
        const restore = installMockFetch({}, calls);
        try {
            const resolved = await resolveSong("Totally Obscure Deep Cut", "Nobody Credited, Someone Else & A Chorus");
            check("resolveSong: exhausted cascade with no hits -> no match", resolved.match === null);
            check(
                "resolveSong: a clean miss is NOT reported as unreachable -- Apple answered, it just had nothing",
                resolved.unreachable === false
            );
            check("resolveSong: tried more than one query before giving up", calls.length > 1, `made ${calls.length} calls`);
        } finally {
            restore();
        }
    }

    // (d) An unreachable upstream (this sandbox's real-world case, and any
    // production hiccup) must degrade to null across the whole cascade, not
    // throw or hang.
    {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () => {
            throw new Error("simulated: itunes.apple.com unreachable");
        }) as typeof fetch;
        try {
            const resolved = await resolveSong("Any Song", "Any Artist");
            check("resolveSong: unreachable upstream degrades to no match rather than throwing", resolved.match === null);
            check(
                "resolveSong: ...and SAYS it was unreachable, so a rate limit is never shown as 'not available'",
                resolved.unreachable === true
            );
        } finally {
            globalThis.fetch = originalFetch;
        }
    }

    // (e) suggestMatches pools candidates across queries and ranks them --
    // this is what powers Problem B's automatic suggestions for an unmatched
    // song. It must return something even when the *first* cascade query is
    // the one that misses.
    {
        const calls: string[] = [];
        const restore = installMockFetch(
            {
                "Zero to Hero": [
                    { trackName: "Zero to Hero", artistName: "Susan Egan, Roger Bart, Lillias White" },
                    { trackName: "Zero to Hero (Reprise)", artistName: "Susan Egan" },
                ],
            },
            calls
        );
        try {
            const suggestions = await suggestMatches("Zero to Hero", "The Muses", 5);
            check("suggestMatches: returns candidates for a generic-credit song via the title-only query", suggestions.length > 0);
            check("suggestMatches: caps at the requested limit", suggestions.length <= 5);
            check(
                "suggestMatches: every returned candidate carries a confidence score for the caller to key off of",
                suggestions.every((s) => s.confidence === "high" || s.confidence === "partial" || s.confidence === "none")
            );
        } finally {
            restore();
        }
    }

    // (f) suggestMatches on a genuinely nonexistent song: empty, not thrown
    // -- what lets PreflightCheck show "no matches found" instead of hanging
    // or crashing the pre-flight screen.
    {
        const restore = installMockFetch({}, []);
        try {
            const suggestions = await suggestMatches("Absolutely Nothing Like This Exists", "Nobody");
            check("suggestMatches: no hits anywhere in the cascade -> empty array, not null/throw", Array.isArray(suggestions) && suggestions.length === 0);
        } finally {
            restore();
        }
    }

    // -- SongRank does not content-filter music, and must not start by
    // accident. These two check the request itself rather than the results:
    // the parameter is stated, and nothing in the pipeline drops a track for
    // what it is. An explicit track quietly vanishing would look exactly like
    // "iTunes doesn't have it", which is the worst kind of bug to ship --
    // invisible, and indistinguishable from an upstream gap.
    {
        const urls: string[] = [];
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            urls.push(typeof input === "string" ? input : input.toString());
            return new Response(JSON.stringify({ results: [] }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }) as typeof fetch;
        try {
            await resolveSong("Chicken Huntin' (Slaughter Mix)", "Insane Clown Posse");
        } finally {
            globalThis.fetch = originalFetch;
        }
        check(
            "search asks Apple to INCLUDE explicit tracks",
            urls.length > 0 && urls.every((u) => new URL(u).searchParams.get("explicit") === "Yes")
        );
        check(
            "nothing in the request filters by content beyond term/media/entity",
            urls.every((u) => {
                const keys = [...new URL(u).searchParams.keys()].sort().join(",");
                return keys === "entity,explicit,limit,media,term";
            })
        );
        // Widened from 5: for a title other people have also recorded, the
        // real track routinely sits outside the first few relevance hits.
        check(
            "each query pulls back a wide enough candidate pool to find a buried track",
            urls.every((u) => Number(new URL(u).searchParams.get("limit")) >= 20)
        );
    }

    // -- The same track, end to end through the cascade, with a catalogue
    // that buries it under the covers and karaoke versions iTunes really does
    // rank first for a well-covered title. At the old limit of 5 this song
    // was unreachable no matter how good the scoring was.
    {
        const noise = (n: number) =>
            Array.from({ length: n }, (_, i) => ({
                trackName: `Chicken Huntin (Karaoke Version ${i + 1})`,
                artistName: "Party Tyme Karaoke",
                previewUrl: "https://example.test/karaoke.m4a",
            }));
        const calls: string[] = [];
        const restore = installMockFetch(
            {
                // The narrowest query finds nothing, as it often does for a
                // remix suffix; the stripped-title query is the one that hits.
                "Chicken Huntin (Slaughter Mix) Insane Clown Posse": [],
                "Chicken Huntin Insane Clown Posse": [
                    ...noise(12),
                    {
                        trackName: "Chicken Huntin' (Slaughter Mix)",
                        artistName: "Insane Clown Posse",
                        previewUrl: "https://example.test/icp.m4a",
                    },
                ],
            },
            calls
        );
        try {
            const resolved = await resolveSong("Chicken Huntin (Slaughter Mix)", "Insane Clown Posse");
            check(
                "an explicit track buried under 12 karaoke hits still resolves",
                resolved?.match?.artist === "Insane Clown Posse" &&
                    resolved.match.title === "Chicken Huntin' (Slaughter Mix)"
            );
            check(
                "...and at high confidence, so it is not flagged for review",
                resolved?.confidence === "high"
            );
        } finally {
            restore();
        }
    }

    // -- A rate limit is the case that actually bites in production, and the
    // one that used to be indistinguishable from an empty catalogue: a 429
    // came back as `results: []` and the song was labelled "No preview
    // available for this track". These prove it is now retried, and reported
    // as unreachable if the retries don't clear it.
    {
        let attempts = 0;
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () => {
            attempts += 1;
            return new Response("", { status: 429, headers: { "retry-after": "0" } });
        }) as typeof fetch;
        try {
            const resolved = await resolveSong("Chicken Huntin' (Slaughter Mix)", "Insane Clown Posse");
            check("rate limit: retried rather than accepted as an empty result", attempts > 1, `${attempts} attempt(s)`);
            check("rate limit: reported as unreachable, not as a missing track", resolved.unreachable === true);
            check("rate limit: no bogus match invented", resolved.match === null);
        } finally {
            globalThis.fetch = originalFetch;
        }
    }

    // -- A 429 that clears on the retry must produce the song, not a miss.
    // This is the whole point of retrying: the track was always there.
    {
        let attempts = 0;
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () => {
            attempts += 1;
            if (attempts === 1) return new Response("", { status: 429, headers: { "retry-after": "0" } });
            return new Response(
                JSON.stringify({
                    results: [
                        {
                            trackName: "Chicken Huntin' (Slaughter Mix)",
                            artistName: "Insane Clown Posse",
                            previewUrl: "https://example.test/icp.m4a",
                        },
                    ],
                }),
                { status: 200, headers: { "Content-Type": "application/json" } }
            );
        }) as typeof fetch;
        try {
            const resolved = await resolveSong("Chicken Huntin' (Slaughter Mix)", "Insane Clown Posse");
            check("rate limit that clears: the track resolves on the retry", resolved.match?.artist === "Insane Clown Posse");
            check("rate limit that clears: not reported as unreachable", resolved.unreachable === false);
        } finally {
            globalThis.fetch = originalFetch;
        }
    }

    // -- A genuine 4xx is us asking a bad question. Retrying it would spend
    // the rate limit the next song needs, so it must NOT be retried.
    {
        let attempts = 0;
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () => {
            attempts += 1;
            return new Response("", { status: 400 });
        }) as typeof fetch;
        try {
            const resolved = await resolveSong("Any Song", "Any Artist");
            check("a 400 is not retried -- retrying an unanswerable query wastes the quota", attempts <= 4, `${attempts} attempt(s)`);
            check("a 400 is a clean miss, not an outage", resolved.unreachable === false && resolved.match === null);
        } finally {
            globalThis.fetch = originalFetch;
        }
    }
}

await runAsyncChecks();

console.log(`\n${checks - failures}/${checks} checks passed.`);
if (failures > 0) {
    console.error(`${failures} FAILED`);
    process.exit(1);
}
