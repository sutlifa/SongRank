// scripts/verify-parse.ts
//
// Headless proof that lib/parse.ts does what problem 1 asked for, run with:
//
//     node --experimental-strip-types scripts/verify-parse.ts
//
// Two layers, two kinds of test:
//   1. The pure/sync layer (parseSongList + the frequency analysis it does
//      internally) is checked against one concrete paste per supported
//      format, plus the multi-line frequency-analysis cases -- no network.
//   2. The catalogue-resolution layer (resolveImportBatch/scoreMatch) is
//      checked with an injected, deterministic mock `SearchFn`, so the
//      high/partial/none/unreachable-network paths are all provable without
//      a real request. This sandbox's proxy blocks itunes.apple.com
//      (verified: 403), so a real network test can't be part of the default
//      run -- see the SONGRANK_PREVIEW_FIXTURES section at the bottom for an
//      opt-in pass that exercises the *actual* lib/itunes.ts, offline, via
//      lib/fixtures.ts.
//
// Not a test framework: exits non-zero on the first failed assertion and
// prints what broke, same shape as scripts/verify-swiss.ts.

import {
    parseSongList,
    resolveImportBatch,
    scoreMatch,
    normalizeForMatch,
    type SearchFn,
} from "../lib/parse.ts";
import type { ParsedSong, SearchResult } from "../lib/types.ts";

let failures = 0;
let checks = 0;

function check(name: string, cond: boolean, detail?: string) {
    checks++;
    if (!cond) {
        failures++;
        console.error(`FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
    }
}

function song(title: string, artist: string): { title: string; artist: string } {
    return { title, artist };
}

function has(list: { title: string; artist: string }[], title: string, artist: string): boolean {
    return list.some((s) => s.title === title && s.artist === artist);
}

// ---------------------------------------------------------------------------
// 1. Pure/sync layer: one representative paste per supported format.
// ---------------------------------------------------------------------------

{
    const r = parseSongList('Daft Punk - Around the World');
    check("dash: single line parses to 2 non-empty fields", r.songs.length === 1);
    check("dash: single isolated line stays ambiguous (no frequency signal)", r.songs[0].ambiguous === true);
}

{
    // (b) frequency analysis: same artist on the LEFT of 12 dash-separated
    // lines -> left is the artist, confidently, for the whole paste.
    const titles = [
        "Harder, Better, Faster, Stronger",
        "One More Time",
        "Around the World",
        "Digital Love",
        "Robot Rock",
        "Da Funk",
        "Instant Crush",
        "Get Lucky",
        "Voyager",
        "Aerodynamic",
        "Veridis Quo",
        "Contact",
    ];
    const text = titles.map((t) => `Daft Punk - ${t}`).join("\n");
    const r = parseSongList(text);
    check("frequency(left=artist): all 12 lines parsed", r.songs.length === 12);
    check(
        "frequency(left=artist): artist resolved to the repeated left side",
        r.songs.every((s) => s.artist === "Daft Punk")
    );
    check(
        "frequency(left=artist): no ambiguous flags left once the majority orientation is confident",
        r.songs.every((s) => s.ambiguous === false)
    );
    check(
        "frequency(left=artist): titles are the varying right side, not 'Daft Punk'",
        r.songs.every((s) => s.title !== "Daft Punk")
    );
}

{
    // Same shape, but the repeated value is on the RIGHT -- orientation must
    // flip, not just default to "left is always artist".
    const titles = ["Take On Me", "The Sun Always Shines on T.V.", "Hunting High and Low", "Train of Thought"];
    const text = titles.map((t) => `${t} - a-ha`).join("\n");
    const r = parseSongList(text);
    check("frequency(right=artist): all 4 lines parsed", r.songs.length === 4);
    check(
        "frequency(right=artist): artist resolved to the repeated right side",
        r.songs.every((s) => s.artist === "a-ha")
    );
    check(
        "frequency(right=artist): confidently unflagged",
        r.songs.every((s) => s.ambiguous === false)
    );
}

{
    // En dash / em dash variants, still frequency-resolved as one "dash" group.
    const text = ["Queen – Bohemian Rhapsody", "Queen — Killer Queen", "Queen - Don't Stop Me Now"].join("\n");
    const r = parseSongList(text);
    check("en/em dash variants: all 3 lines parsed", r.songs.length === 3);
    check("en/em dash variants: grouped with plain dashes for frequency analysis", r.songs.every((s) => s.artist === "Queen"));
}

{
    const r = parseSongList("Hold On - We're Going Home by Drake");
    check(
        "'by' is unambiguous even when the title itself contains a dash",
        r.songs.length === 1 && r.songs[0].title === "Hold On - We're Going Home" && r.songs[0].artist === "Drake"
    );
    check("'by' rows are never ambiguous", r.songs[0].ambiguous === false);
}

{
    const r = parseSongList("Queen: Bohemian Rhapsody");
    check(
        "'Artist: Title' colon form",
        r.songs.length === 1 && r.songs[0].artist === "Queen" && r.songs[0].title === "Bohemian Rhapsody" && !r.songs[0].ambiguous
    );
}

{
    const r = parseSongList("Hotel California, Eagles");
    check(
        "'Title, Artist' comma form",
        r.songs.length === 1 && r.songs[0].title === "Hotel California" && r.songs[0].artist === "Eagles" && !r.songs[0].ambiguous
    );
}

{
    // "Title | Artist" -- ambiguous separator, frequency-resolved same as dash.
    const text = ["Fake Plastic Trees | Radiohead", "Karma Police | Radiohead", "Creep | Radiohead"].join("\n");
    const r = parseSongList(text);
    check("pipe separator + frequency", r.songs.length === 3 && r.songs.every((s) => s.artist === "Radiohead"));
}

{
    // Tab-separated Excel/Sheets paste, no header -- frequency analysis must
    // work regardless of which physical column the artist happens to sit in.
    const rows = [
        ["Blinding Lights", "The Weeknd"],
        ["Save Your Tears", "The Weeknd"],
        ["In Your Eyes", "The Weeknd"],
        ["Die For You", "The Weeknd"],
    ];
    const text = rows.map((r) => r.join("\t")).join("\n");
    const r = parseSongList(text);
    check("tab-separated (no header) + frequency", r.songs.length === 4 && r.songs.every((s) => s.artist === "The Weeknd"));
}

{
    const cases: [string, string, string][] = [
        ["1. Bohemian Rhapsody by Queen", "Bohemian Rhapsody", "Queen"],
        ["01) Bohemian Rhapsody by Queen", "Bohemian Rhapsody", "Queen"],
        ["1 - Bohemian Rhapsody by Queen", "Bohemian Rhapsody", "Queen"],
        ["- Bohemian Rhapsody by Queen", "Bohemian Rhapsody", "Queen"],
        ["• Bohemian Rhapsody by Queen", "Bohemian Rhapsody", "Queen"],
    ];
    for (const [line, title, artist] of cases) {
        const r = parseSongList(line);
        check(`numbered/bulleted prefix stripped: "${line}"`, r.songs.length === 1 && r.songs[0].title === title && r.songs[0].artist === artist);
        check(`raw is preserved verbatim (with prefix) for "${line}"`, r.songs[0].raw === line);
    }
}

{
    const r = parseSongList('"Take On Me" by A-ha');
    check("quoted title before 'by'", r.songs.length === 1 && r.songs[0].title === "Take On Me" && r.songs[0].artist === "A-ha");
}

{
    const r1 = parseSongList("Bohemian Rhapsody by Queen 5:55");
    check("trailing bare duration stripped", r1.songs[0].artist === "Queen");
    const r2 = parseSongList("Bohemian Rhapsody by Queen (5:55)");
    check("trailing parenthesized duration stripped", r2.songs[0].artist === "Queen");
}

{
    const r = parseSongList("Queen - Bohemian Rhapsody (A Night At The Opera)");
    check(
        "trailing album annotation stripped from the end of the line",
        r.songs.length === 1 && !r.songs[0].title.includes("Night At The Opera") && !r.songs[0].artist.includes("Night At The Opera")
    );
}

{
    const r = parseSongList("Not Alone by Anna Clendening & Tommee Profitt");
    check(
        "multi-artist '&' form keeps the full artist string, not just the first name",
        r.songs.length === 1 && r.songs[0].artist === "Anna Clendening & Tommee Profitt"
    );
}

{
    const r = parseSongList("Test Title (feat. Someone Else) by Some Artist");
    check(
        "a feat. clause in a trailing parenthetical is NOT stripped as an album annotation",
        r.songs.length === 1 && r.songs[0].title.includes("feat. Someone Else")
    );
}

{
    const spotifyExport = [
        'Track Name,Artist Name(s),Album Name,Added By,Added At',
        '"Bohemian Rhapsody","Queen","A Night at the Opera",user123,2024-01-01',
        '"Take On Me","a-ha","Hunting High and Low",user123,2024-01-02',
        '"Rich, Beautiful and Sad","Voila, Capital",Some Album,user123,2024-01-03',
    ].join("\n");
    const r = parseSongList(spotifyExport);
    check("Spotify CSV export: header detected, 3 data rows parsed", r.songs.length === 3);
    check("Spotify CSV export: column-mapped, not ambiguous", r.songs.every((s) => s.ambiguous === false));
    check("Spotify CSV export: title/artist correctly assigned", has(r.songs, "Bohemian Rhapsody", "Queen") && has(r.songs, "Take On Me", "a-ha"));
    check(
        "Spotify CSV export: a comma-quoted title isn't torn apart by the per-line comma heuristic",
        has(r.songs, "Rich, Beautiful and Sad", "Voila, Capital")
    );
}

{
    const appleExport = ["Name\tArtist\tAlbum\tTime", "Bohemian Rhapsody\tQueen\tA Night at the Opera\t5:55", "Take On Me\ta-ha\tHunting High and Low\t3:46"].join(
        "\n"
    );
    const r = parseSongList(appleExport);
    check("Apple Music TSV export: header detected, 2 rows parsed", r.songs.length === 2);
    check("Apple Music TSV export: correctly mapped", has(r.songs, "Bohemian Rhapsody", "Queen") && has(r.songs, "Take On Me", "a-ha"));
}

{
    const text = [
        "",
        "  ",
        "----------",
        "https://open.spotify.com/playlist/abc123",
        "Disc 1:",
        "1. Bohemian Rhapsody by Queen",
        "",
        "2. Take On Me by a-ha",
    ].join("\n");
    const r = parseSongList(text);
    check("blank lines, share links, dividers and disc headers are ignored, not parsed as songs", r.songs.length === 2);
    check("real lines around junk still parse correctly", has(r.songs, "Bohemian Rhapsody", "Queen") && has(r.songs, "Take On Me", "a-ha"));
}

{
    const r = parseSongList("Bohemian Rhapsody by Queen\nBOHEMIAN RHAPSODY by QUEEN\nbohemian rhapsody BY queen");
    check("de-duplicates case-insensitively", r.songs.length === 1 && r.duplicates === 2);
}

{
    const lines = Array.from({ length: 260 }, (_, i) => `Track ${i} by Artist ${i}`);
    const r = parseSongList(lines.join("\n"));
    check("truncates at MAX_SONGS (256)", r.songs.length === 256);
    check("reports the truncated count", r.truncated === 4);
}

// ---------------------------------------------------------------------------
// 2. scoreMatch / normalizeForMatch: unit-level checks on the confidence
//    scorer itself, independent of any network.
// ---------------------------------------------------------------------------

{
    check(
        "normalizeForMatch strips diacritics",
        normalizeForMatch("Beyoncé") === normalizeForMatch("beyonce")
    );
    check(
        "normalizeForMatch drops a feat. clause for comparison purposes",
        normalizeForMatch("Not Alone (feat. Someone)") === normalizeForMatch("Not Alone")
    );
}

{
    const high = scoreMatch("Daft Punk - Around the World", song("Around the World", "Daft Punk"));
    check("scoreMatch: both sides present -> high", high === "high");

    const partial = scoreMatch("Around the World", song("Around the World", "Daft Punk"));
    check("scoreMatch: title only -> partial (artist wasn't in the line at all)", partial === "partial");

    const none = scoreMatch("some completely unrelated text", song("Around the World", "Daft Punk"));
    check("scoreMatch: no overlap -> none", none === "none");

    const highWithThe = scoreMatch("The Beatles - Come Together", song("Come Together", "The Beatles"));
    check("scoreMatch: stopwords don't block a high match", highWithThe === "high");
}

// ---------------------------------------------------------------------------
// 3. resolveImportBatch: mock SearchFn, no network. Covers high/partial/
//    none, and the "upstream throws" degrade-gracefully path the task
//    specifically calls out.
// ---------------------------------------------------------------------------

async function runAsyncChecks() {
    // (a) The catalogue corrects a heuristic guess that got the orientation
    // backwards -- e.g. a quoted title on the left of a dash, which the pure
    // layer (with no frequency signal from a single line) defaults wrong.
    {
        const parsed = parseSongList('"Bohemian Rhapsody" - Queen').songs;
        check("setup: heuristic guessed the wrong orientation for this single quoted-title line", parsed[0].artist === "Bohemian Rhapsody");

        const mockSearch: SearchFn = async (term) => {
            check("resolveImportBatch searches with the RAW line, not the heuristic guess", term === parsed[0].raw);
            const result: SearchResult = {
                title: "Bohemian Rhapsody",
                artist: "Queen",
                album: "A Night at the Opera",
                artworkUrl: "https://example.com/art.jpg",
                previewUrl: "https://example.com/preview.m4a",
                previewSeconds: 30,
                itunesId: 1,
            };
            return [result];
        };

        const resolved = await resolveImportBatch(parsed, mockSearch);
        check("high confidence: title corrected from the catalogue", resolved[0].title === "Bohemian Rhapsody");
        check("high confidence: artist corrected from the catalogue", resolved[0].artist === "Queen");
        check("high confidence: no longer flagged for review", resolved[0].ambiguous === false);
        check("high confidence: confidence reported as 'high'", resolved[0].confidence === "high");
        check("high confidence: matched candidate attached", resolved[0].matched?.previewUrl === "https://example.com/preview.m4a");
    }

    // (b) A partial match keeps the heuristic guess but stays flagged.
    {
        const parsed: ParsedSong[] = [{ title: "Some Song", artist: "Some Artist", raw: "Some Song - Some Artist", ambiguous: true }];
        const mockSearch: SearchFn = async () => [
            { title: "Some Song (Live)", artist: "A Totally Different Person", album: null, artworkUrl: null, previewUrl: null, previewSeconds: null, itunesId: 2 },
        ];
        const resolved = await resolveImportBatch(parsed, mockSearch);
        check("partial confidence: title NOT overwritten", resolved[0].title === "Some Song");
        check("partial confidence: artist NOT overwritten", resolved[0].artist === "Some Artist");
        check("partial confidence: still flagged for review", resolved[0].ambiguous === true);
        check("partial confidence: reported as 'partial'", resolved[0].confidence === "partial");
        check("partial confidence: candidate still surfaced as a hint", resolved[0].matched !== null);
    }

    // (c) No usable result at all.
    {
        const parsed: ParsedSong[] = [{ title: "Totally Obscure Thing", artist: "", raw: "Totally Obscure Thing", ambiguous: true }];
        const mockSearch: SearchFn = async () => [];
        const resolved = await resolveImportBatch(parsed, mockSearch);
        check("no match: confidence 'none'", resolved[0].confidence === "none");
        check("no match: matched is null", resolved[0].matched === null);
        check("no match: falls back to the heuristic's own ambiguous flag", resolved[0].ambiguous === true);
    }

    // (d) Upstream unreachable (this sandbox's real-world case): must never
    // throw, hang, or produce anything but a graceful "none" degrade.
    {
        const parsed: ParsedSong[] = Array.from({ length: 20 }, (_, i) => ({
            title: `Song ${i}`,
            artist: `Artist ${i}`,
            raw: `Song ${i} - Artist ${i}`,
            ambiguous: true,
        }));
        const throwingSearch: SearchFn = async () => {
            throw new Error("simulated: itunes.apple.com unreachable");
        };
        const started = Date.now();
        const resolved = await resolveImportBatch(parsed, throwingSearch, { concurrency: 6 });
        const elapsedMs = Date.now() - started;
        check("unreachable upstream: resolves (doesn't throw) for the whole batch", resolved.length === 20);
        check("unreachable upstream: every row degrades to confidence 'none'", resolved.every((s) => s.confidence === "none"));
        check(
            "unreachable upstream: every row keeps its heuristic title/artist rather than going blank",
            resolved.every((s, i) => s.title === parsed[i].title && s.artist === parsed[i].artist)
        );
        check("unreachable upstream: finishes quickly when the failure is immediate (not a hang)", elapsedMs < 5000, `took ${elapsedMs}ms`);
    }

    // (e) onProgress fires for every song, in order, ending at the total.
    {
        const parsed: ParsedSong[] = Array.from({ length: 9 }, (_, i) => ({ title: `T${i}`, artist: `A${i}`, raw: `T${i} - A${i}`, ambiguous: true }));
        const calls: [number, number][] = [];
        await resolveImportBatch(parsed, async () => [], {
            concurrency: 3,
            onProgress: (done, total) => calls.push([done, total]),
        });
        check("onProgress fires once per song", calls.length === 9);
        check("onProgress ends at done === total", calls[calls.length - 1][0] === 9 && calls[calls.length - 1][1] === 9);
    }
}

// ---------------------------------------------------------------------------
// 4. Optional: the real lib/itunes.ts, offline, via the fixture switch.
//    Only runs with SONGRANK_PREVIEW_FIXTURES=1 -- see that env var's own
//    docs in lib/fixtures.ts and lib/itunes.ts for why it exists. Skipped
//    (not failed) otherwise, so the default `node --experimental-strip-types
//    scripts/verify-parse.ts` run stays fully offline and deterministic.
// ---------------------------------------------------------------------------

async function runFixtureIntegrationCheck() {
    if (process.env.SONGRANK_PREVIEW_FIXTURES !== "1") {
        console.log("SKIP  real lib/itunes.ts integration (set SONGRANK_PREVIEW_FIXTURES=1 to run it)");
        return;
    }
    const { searchSongs } = await import("../lib/itunes.ts");
    const parsed = parseSongList("Amber Static - The Faux Tones").songs; // matches a lib/fixtures.ts entry
    const resolved = await resolveImportBatch(parsed, (term) => searchSongs(term));
    check("fixture integration: resolves against the real lib/itunes.ts (fixture-backed)", resolved.length === 1);
    check("fixture integration: high confidence on an exact fixture match", resolved[0].confidence === "high");
    check("fixture integration: preview URL comes from the fixture tone generator", Boolean(resolved[0].matched?.previewUrl?.includes("/api/preview/tone")));
}

await runAsyncChecks();
await runFixtureIntegrationCheck();

console.log(`\n${checks - failures}/${checks} checks passed.`);
if (failures > 0) {
    console.error(`${failures} FAILED`);
    process.exit(1);
}
