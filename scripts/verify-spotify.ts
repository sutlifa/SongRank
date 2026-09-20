// scripts/verify-spotify.ts
//
// Proof that the Spotify export picks the right recording, run with:
//
//     node --experimental-strip-types scripts/verify-spotify.ts
//
// This is the half of lib/spotify.ts that can be tested at all: this sandbox's
// proxy blocks api.spotify.com exactly as it blocks itunes.apple.com, so the
// HTTP is exercised only by a first real run. Everything that can be wrong in
// an interesting way is pure and is checked here against a fake catalogue.
//
// Why it matters more than it looks: a wrong match does not fail. It lands a
// karaoke version, or a cover, or the live recording in somebody's playlist,
// and the playlist looks completely normal. That silent-wrongness is the exact
// reason the old Spotify import was removed rather than fixed, and it is the
// failure this file exists to make loud.

import {
    searchQueries,
    toTrack,
    pickBest,
    isConfident,
    versionMismatch,
    batchUris,
    isTrackUri,
    cleanUris,
    playlistDescription,
    matchOne,
    matchTracks,
    cacheKey,
    MATCH_CONCURRENCY,
    MAX_URIS_PER_REQUEST,
    retryAfterSeconds,
    SpotifyUnavailableError,
    type SpotifyTrack,
} from "../lib/spotify.ts";

let checks = 0;
const failures: string[] = [];
function check(label: string, actual: unknown, expected: unknown): void {
    checks += 1;
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) failures.push(`${label}\n    expected ${e}\n    actual   ${a}`);
}

// --- phrasing the query ---------------------------------------------------
check("both filters first", searchQueries("Let It Go", "Idina Menzel")[0], 'track:"Let It Go" artist:"Idina Menzel"');
check("then plain text", searchQueries("Let It Go", "Idina Menzel")[1], "Let It Go Idina Menzel");
// TWO rungs, not three. Every extra rung is another request per song against a
// quota counted in requests, and the third existed only to rescue the long
// credit case that the primary-artist fix below handles at the source.
check("and no more than two", searchQueries("Let It Go", "Idina Menzel").length, 2);

// THE expensive bug this pins. `artist:` matches an artist NAME, and a
// soundtrack credit is not one -- so the filtered query matched nothing, every
// such song fell through the whole ladder, and a Disney ranking cost three
// requests per song instead of one. These are real credits from a real
// ranking.
check(
    "a soundtrack credit is reduced to its primary artist",
    searchQueries("Be Prepared", "Jeremy Irons, Whoopi Goldberg, Cheech Marin & Jim Cummings")[0],
    'track:"Be Prepared" artist:"Jeremy Irons"'
);
check(
    "...including the seven-name kind",
    searchQueries(
        "We Don't Talk About Bruno",
        "Carolina Gaitan - La Gaita, Mauro Castillo, Adassa, Rhenzy Feliz, Diane Guerrero, Stephanie Beatriz & Encanto - Cast"
    )[0],
    'track:"We Don t Talk About Bruno" artist:"Carolina Gaitan - La Gaita"'
);
check(
    "a featured credit drops the guest",
    searchQueries("Empire State of Mind", "JAY-Z feat. Alicia Keys")[0],
    'track:"Empire State of Mind" artist:"JAY-Z"'
);
check(
    "a plain single artist is untouched",
    searchQueries("Bohemian Rhapsody", "Queen")[0],
    'track:"Bohemian Rhapsody" artist:"Queen"'
);
// A quote in a title must not break out of its own field filter and turn the
// rest of the query into syntax.
check("quotes are stripped", searchQueries('Don"t Stop', "Queen")[0], 'track:"Don t Stop" artist:"Queen"');
check("apostrophes too", searchQueries("Don't Stop Me Now", "Queen")[0], 'track:"Don t Stop Me Now" artist:"Queen"');
// No artist: the title filter and the plain query would be the same string,
// and asking a rate-limited endpoint the same question twice is waste.
check("no artist yields one plain query", searchQueries("Let It Go", ""), ["Let It Go"]);
check("nothing to search for", searchQueries("", ""), []);

// --- reading the response -------------------------------------------------
const raw = {
    id: "t1",
    uri: "spotify:track:t1",
    name: "Let It Go",
    explicit: false,
    duration_ms: 225_000,
    album: { name: "Frozen" },
    artists: [{ name: "Idina Menzel" }],
};
check("a usable hit is flattened", toTrack(raw)?.uri, "spotify:track:t1");
check("album carried", toTrack(raw)?.album, "Frozen");
check("multiple artists joined", toTrack({ ...raw, artists: [{ name: "A" }, { name: "B" }] })?.artist, "A, B");
check("missing artists is empty, not a crash", toTrack({ ...raw, artists: undefined })?.artist, "");
// No uri means it cannot go in a playlist, so it must not survive as a
// half-filled object to be discovered later somewhere less able to say so.
check("no uri is dropped", toTrack({ ...raw, uri: undefined }), null);
check("no id is dropped", toTrack({ ...raw, id: undefined }), null);
check("no name is dropped", toTrack({ ...raw, name: undefined }), null);

// --- choosing a candidate -------------------------------------------------
const track = (id: string, title: string, artist: string): SpotifyTrack => ({
    id, uri: `spotify:track:${id}`, title, artist, album: null, durationMs: null, explicit: false,
});
const target = { title: "Be Prepared", artist: "Jeremy Irons" };

check("exact match wins", pickBest(target, [track("a", "Be Prepared", "Jeremy Irons")]).confidence, "high");
check("nothing usable", pickBest(target, [track("a", "Hakuna Matata", "Nathan Lane")]).confidence, "none");
check("empty candidate list", pickBest(target, []).match, null);

// Relevance order breaks ties, because it is better information than anything
// this code could invent: two recordings can be textually identical.
const dupes = [track("first", "Be Prepared", "Jeremy Irons"), track("second", "Be Prepared", "Jeremy Irons")];
check("first of equal matches wins", pickBest(target, dupes).match?.id, "first");

// The buried studio version: a run of poor candidates must not stop the good
// one further down being found.
const buried = [
    track("x1", "Hakuna Matata", "Nathan Lane"),
    track("x2", "Circle of Life", "Carmen Twillie"),
    track("x3", "Be Prepared", "Jeremy Irons"),
];
check("a good match buried behind bad ones is still found", pickBest(target, buried).match?.id, "x3");

// --- only "high" ships unattended ----------------------------------------
check("high is confident", isConfident("high"), true);
check("partial is NOT confident", isConfident("partial"), false);
check("none is not confident", isConfident("none"), false);

// --- the version trap -----------------------------------------------------
// Same title, same credited artist, completely different recording. Every
// text measure scores this "high", which is precisely why it needs flagging
// separately rather than being left to the scorer.
check("karaoke flagged", versionMismatch({ title: "Be Prepared" }, { title: "Be Prepared (Karaoke Version)" }), true);
check("live flagged", versionMismatch({ title: "Bohemian Rhapsody" }, { title: "Bohemian Rhapsody - Live Aid" }), true);
check("remix flagged", versionMismatch({ title: "Chicken Huntin'" }, { title: "Chicken Huntin' (Slaughter Remix)" }), true);
// ...but not when the ranking ASKED for that version.
check("asked for the remix", versionMismatch({ title: "Chicken Huntin' (Slaughter Mix)" }, { title: "Chicken Huntin' (Slaughter Mix)" }), false);
check("asked for live", versionMismatch({ title: "Bohemian Rhapsody - Live" }, { title: "Bohemian Rhapsody - Live Aid" }), false);
check("ordinary track not flagged", versionMismatch({ title: "Let It Go" }, { title: "Let It Go" }), false);

// --- batching -------------------------------------------------------------
const uris = Array.from({ length: 250 }, (_, i) => `spotify:track:${i}`);
check("batch count", batchUris(uris).length, 3);
check("batch sizes", batchUris(uris).map((b) => b.length), [100, 100, 50]);
check("order is preserved across batches", batchUris(uris).flat(), uris);
check("exactly one full batch is one batch", batchUris(uris.slice(0, 100)).length, 1);
check("empty input", batchUris([]), []);
check("the limit is Spotify's", MAX_URIS_PER_REQUEST, 100);

// --- what may be written to somebody's account ---------------------------
// The review screen sends back the uris the person accepted, so this is the
// boundary where a client-supplied string becomes a write on their Spotify
// account. The endpoint is reachable directly, so the shape is checked rather
// than trusted.
check("a track uri is accepted", isTrackUri("spotify:track:4cOdK2wGLETKBW3PvgPWqT"), true);
check("a playlist uri is not a track", isTrackUri("spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"), false);
check("an album uri is not a track", isTrackUri("spotify:album:4cOdK2wGLETKBW3PvgPWqT"), false);
check("an episode uri is not a track", isTrackUri("spotify:episode:4cOdK2wGLETKBW3PvgPWqT"), false);
check("a web url is not a uri", isTrackUri("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT"), false);
// A comma-smuggled second uri must not pass as one value.
check("a smuggled second uri is refused", isTrackUri("spotify:track:abc,spotify:playlist:x"), false);
check("empty is refused", isTrackUri(""), false);
check("a number is refused", isTrackUri(42), false);
check("null is refused", isTrackUri(null), false);

check(
    "cleanUris keeps only valid ones, in order",
    cleanUris([
        "spotify:track:aaaaaaaaaaaaaaaaaaaaaa",
        "spotify:playlist:bbbbbbbbbbbbbbbbbbbbbb",
        "spotify:track:cccccccccccccccccccccc",
        null,
        7,
    ]),
    ["spotify:track:aaaaaaaaaaaaaaaaaaaaaa", "spotify:track:cccccccccccccccccccccc"]
);
// A ranking cannot contain the same song twice, so a duplicate arriving means
// something upstream is wrong; writing it twice is not a kindness.
check(
    "duplicates are dropped",
    cleanUris(["spotify:track:aaaaaaaaaaaaaaaaaaaaaa", "spotify:track:aaaaaaaaaaaaaaaaaaaaaa"]).length,
    1
);
check("nothing valid yields nothing", cleanUris(["spotify:playlist:x", null]), []);

check(
    "the description says where the playlist came from",
    playlistDescription("Disney", 200, 1911),
    "Disney — ranked on SongRank from 1911 head-to-head picks across 200 songs."
);

// --- the ladder, end to end against a fake catalogue ----------------------
const CATALOGUE: SpotifyTrack[] = [
    track("s1", "Be Prepared", "Jeremy Irons, Whoopi Goldberg, Cheech Marin & Jim Cummings"),
    track("s2", "Let It Go", "Idina Menzel"),
    track("s3", "Chickin \"Pluckin\" Huntin Remix", "Insane Clown Posse"),
];
/** A deliberately literal stand-in: it honours field filters the way Spotify
 * does, so a rung that would return nothing really does return nothing. */
const queried: string[] = [];
const fakeSearch = async (query: string) => {
    queried.push(query);
    const filters = [...query.matchAll(/(track|artist):"([^"]+)"/g)];
    if (filters.length > 0) {
        return CATALOGUE.filter((t) =>
            filters.every(([, field, value]) => {
                const hay = (field === "track" ? t.title : t.artist).toLowerCase();
                return hay.includes(value.toLowerCase());
            })
        );
    }
    const words = query.toLowerCase().split(" ").filter(Boolean);
    return CATALOGUE.filter((t) => words.some((w) => `${t.title} ${t.artist}`.toLowerCase().includes(w)));
};

queried.length = 0;
const clean = await matchOne({ title: "Let It Go", artist: "Idina Menzel" }, fakeSearch);
check("a clean song matches", clean.match?.id, "s2");
check("...on the first rung, without further queries", queried.length, 1);

// The long-soundtrack-credit case rung 2 exists for: our artist string is the
// full credit, Spotify files it the same way here, but the first rung is the
// one that should answer.
queried.length = 0;
const longCredit = await matchOne(
    { title: "Be Prepared", artist: "Jeremy Irons, Whoopi Goldberg, Cheech Marin & Jim Cummings" },
    fakeSearch
);
check("long credit matches", longCredit.match?.id, "s1");

// A song Spotify simply does not have must come back as a clean miss, not as
// the nearest thing on the shelf.
queried.length = 0;
const missing = await matchOne({ title: "Thunderstruck", artist: "AC/DC" }, fakeSearch);
check("a genuine absence is a miss", missing.match, null);
check("...and is reported as none", missing.confidence, "none");
check("...after trying every rung", queried.length >= 2, true);

// The whole ranking, in order, with the misses kept in place rather than
// silently dropped -- the review screen has to show what did NOT match.
const all = await matchTracks(
    [
        { title: "Let It Go", artist: "Idina Menzel" },
        { title: "Thunderstruck", artist: "AC/DC" },
        { title: "Be Prepared", artist: "Jeremy Irons" },
    ],
    fakeSearch
);
check("every song is accounted for", all.length, 3);
check("ranks are 1-based and in order", all.map((m) => m.rank), [1, 2, 3]);
check("the miss is kept, not dropped", all[1].match, null);
check("matches carry their uri", all[2].match?.uri, "spotify:track:s1");

// --- order under concurrency ---------------------------------------------
//
// Lookups run a few at a time, so results arrive out of order. The playlist IS
// the ranking, so a result array reflecting COMPLETION order instead of rank
// order would silently produce a shuffled playlist -- intermittently, decided
// by which searches happened to be slow. That is the worst shape of bug this
// feature could have, so the delays below are deliberately inverted: the first
// song is the slowest and the last is instant.
const slowFirst: SpotifyTrack[] = Array.from({ length: 12 }, (_, i) =>
    track(`id${i}`, `Track ${i}`, "Artist")
);
let inFlight = 0;
let peakInFlight = 0;
const staggered = async (query: string) => {
    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);
    const index = Number(query.match(/Track (\d+)/)?.[1] ?? "0");
    // Earlier tracks wait longer, so completion order is the reverse of rank.
    await new Promise((resolve) => setTimeout(resolve, (slowFirst.length - index) * 4));
    inFlight -= 1;
    return slowFirst.filter((t) => t.title === `Track ${index}`);
};

const ordered = await matchTracks(
    slowFirst.map((t) => ({ title: t.title, artist: t.artist })),
    staggered
);
check("every song is present", ordered.length, 12);
check("ranks come back in order", ordered.map((m) => m.rank), Array.from({ length: 12 }, (_, i) => i + 1));
check(
    "each rank carries ITS OWN song, not whichever finished first",
    ordered.every((m, i) => m.title === `Track ${i}` && m.match?.id === `id${i}`),
    true
);
check("no gaps in the result array", ordered.every((m) => m !== undefined), true);
// The DEFAULT is serial, because a development-mode quota is counted in
// requests and parallelism only spends it sooner. Asserted so that raising it
// is a deliberate decision after getting an extended quota, not a quiet tuning
// change that reintroduces the 429.
check("the default is one at a time", MATCH_CONCURRENCY, 1);
check("...and the default really is serial", peakInFlight, 1);

// The mechanism still has to work, because it is what keeps order correct when
// concurrency is ever raised again. Exercised explicitly rather than relying
// on the default to prove it.
let parallelPeak = 0;
let parallelInFlight = 0;
const parallelSearch = async (query: string) => {
    parallelInFlight += 1;
    parallelPeak = Math.max(parallelPeak, parallelInFlight);
    const index = Number(query.match(/Track (\d+)/)?.[1] ?? "0");
    await new Promise((resolve) => setTimeout(resolve, (slowFirst.length - index) * 4));
    parallelInFlight -= 1;
    return slowFirst.filter((t) => t.title === `Track ${index}`);
};
const parallel = await matchTracks(
    slowFirst.map((t) => ({ title: t.title, artist: t.artist })),
    parallelSearch,
    { concurrency: 3 }
);
check("raising concurrency really overlaps lookups", parallelPeak > 1, true);
check("...stays within what was asked for", parallelPeak <= 3, true);
check(
    "...and STILL comes back in rank order",
    parallel.every((m, i) => m.rank === i + 1 && m.title === `Track ${i}`),
    true
);

// A slice of a longer ranking must report the ranks it actually occupies.
const slice = await matchTracks(
    [{ title: "Track 3", artist: "Artist" }, { title: "Track 4", artist: "Artist" }],
    staggered,
    { startRank: 26 }
);
check("a slice reports its real ranks", slice.map((m) => m.rank), [26, 27]);

check("an empty list is fine", (await matchTracks([], staggered)).length, 0);

// --- rate limiting -------------------------------------------------------
//
// Spotify meters this endpoint PER APPLICATION, and an app in development mode
// has a small allowance -- so a long ranking really will be throttled partway
// through. A 429 is a scheduling instruction, not a failure, and the only
// useful response is to wait exactly as long as asked. Ignoring the header and
// retrying sooner EXTENDS the penalty, which makes a wrong answer here
// actively worse than doing nothing.
const withHeader = (value: string | null) =>
    ({ headers: { get: (name: string) => (name.toLowerCase() === "retry-after" ? value : null) } }) as Response;

check("plain seconds are read", retryAfterSeconds(withHeader("30")), 30);
check("zero is a real answer, not a missing one", retryAfterSeconds(withHeader("0")), 0);
check("no header means no instruction", retryAfterSeconds(withHeader(null)), null);
check("nonsense is not mistaken for a number", retryAfterSeconds(withHeader("soon")), null);
// A limiter is allowed to ask for longer than anyone should block for, and the
// answer must say so RATHER THAN a comfortable number.
//
// This is the check that was wrong, and wrong in the direction that matters.
// It used to assert a cap of 300 seconds, which turned every real lockout into
// "come back in about 5 minutes" on screen -- so someone waited five minutes,
// tried again, was told five minutes again, and reasonably concluded the app
// was broken. Whether a wait is short enough to sleep on is a SEPARATE
// question, decided by MAX_INLINE_WAIT_MS, and collapsing the two is what
// produced a sentence that could never come true.
check("an hour means an hour, not a comfortable five minutes", retryAfterSeconds(withHeader("3600")), 3600);
check("...and half a day means half a day", retryAfterSeconds(withHeader("43200")), 43200);
// Bounded only against nonsense, so nothing renders "in about 400 years".
check("a preposterous wait is still bounded", retryAfterSeconds(withHeader("99999999")), 24 * 60 * 60);
check("a negative wait is refused", retryAfterSeconds(withHeader("-5")), null);
// An HTTP-date form is legal and Spotify may use it.
const inTwoMinutes = new Date(Date.now() + 120_000).toUTCString();
const fromDate = retryAfterSeconds(withHeader(inTwoMinutes));
check("an HTTP-date is understood", fromDate !== null && fromDate > 100 && fromDate <= 125, true);
// The date form has to survive the same way the seconds form does: an hour
// away is an hour, not a capped five minutes.
const inAnHour = new Date(Date.now() + 3_600_000).toUTCString();
const hourFromDate = retryAfterSeconds(withHeader(inAnHour));
check("a distant HTTP-date is not clamped either", hourFromDate !== null && hourFromDate > 3500, true);

// The wait must survive the trip to the caller. It is the whole point: the
// pause belongs in a browser, not inside a serverless function's budget.
const limited = new SpotifyUnavailableError("HTTP 429", 30);
check("the error carries the wait", limited.retryAfterSeconds, 30);
check("...and the reason", limited.reason, "HTTP 429");
check("an error with no instruction says so", new SpotifyUnavailableError("network error").retryAfterSeconds, null);

// Concurrency is part of this: it was lowered after a real 429, and turning it
// back up without an extended quota just moves where the limit lands.
check("lookups stay gentle by default", MATCH_CONCURRENCY <= 2, true);

// --- never paying for the same song twice --------------------------------
//
// With a development-mode quota a search result is the scarcest thing this
// feature has, so every answer is remembered (spotify_track_matches, written
// through lib/queries.ts). Two things have to hold for that to be worth
// anything, and both are checked here.

// ONE: the key has to be the SONG, not the way one ranking happened to spell
// it. Soundtrack credits are the case that matters -- the same recording
// arrives as a seven-name credit in one list and a single name in another, and
// if those land on different rows the cache pays twice for one song.
const wholeCast = cacheKey("Let It Go", "Idina Menzel, Kristen Anderson-Lopez & Robert Lopez");
const justHer = cacheKey("let it go", "Idina Menzel");
check("the same song from two credit styles is one key", wholeCast, justHer);
check("case and trailing punctuation do not split a key", cacheKey("Don't Stop!", "Queen"), cacheKey("don't stop", "queen"));
// Known limit, asserted rather than wished away: normalizeForMatch turns an
// apostrophe into a SPACE, so "Don't" and "Dont" are different keys. That is
// a cache miss, never a wrong answer, and it is not worth changing
// normalizeForMatch for -- that function also decides what counts as a match
// and what counts as a duplicate song, and moving it moves those too.
check(
    "an apostrophe dropped entirely is a different key (a miss, not a lie)",
    cacheKey("Don't Stop", "Queen").titleKey === cacheKey("Dont Stop", "Queen").titleKey,
    false
);
// And it must still SEPARATE things that are genuinely different, or the cache
// starts handing back the wrong track, which is the silent wrongness this
// whole file exists to prevent.
check(
    "different artists stay different keys",
    cacheKey("Hallelujah", "Jeff Buckley").artistKey === cacheKey("Hallelujah", "Leonard Cohen").artistKey,
    false
);
check(
    "different titles stay different keys",
    cacheKey("Africa", "Toto").titleKey === cacheKey("Rosanna", "Toto").titleKey,
    false
);
// A song with no artist credit is a real case (a bare title list) and must not
// blow up or collapse into some other song.
check("a missing artist is an empty key, not a crash", cacheKey("Untitled", "").artistKey, "");

// TWO: an answer already paid for must survive the request that fails.
//
// This is the bug the user actually hit. A 429 part-way through a batch
// rejected matchTracks, the caller's "await, then remember" discarded every
// answer already bought, and so coming back after the penalty re-paid for the
// same songs, died in the same place, and never advanced. `onResult` fires as
// each answer lands so the caller can bank it before the throw.
const banked: { index: number; title: string }[] = [];
let asked = 0;
const diesPartway = async (query: string) => {
    asked += 1;
    // Four answers, then the limiter closes the door.
    if (asked > 4) throw new SpotifyUnavailableError("HTTP 429", 1800);
    const index = Number(query.match(/Track (\d+)/)?.[1] ?? "0");
    return slowFirst.filter((t) => t.title === `Track ${index}`);
};
let threw: unknown = null;
try {
    await matchTracks(
        slowFirst.slice(0, 8).map((t) => ({ title: t.title, artist: t.artist })),
        diesPartway,
        { onResult: (index, result) => banked.push({ index, title: result.title }) }
    );
} catch (err) {
    threw = err;
}
check("a rate limit still reaches the caller", threw instanceof SpotifyUnavailableError, true);
// The number is what makes this worth doing: four songs bought, four songs
// kept. If this ever reads 0 the cache cannot advance through a lockout, which
// is indistinguishable from not having a cache at all.
check("every answer bought before the limit was handed over", banked.length, 4);
check(
    "...each one tagged with the song it belongs to",
    banked.map((b) => b.title),
    ["Track 0", "Track 1", "Track 2", "Track 3"]
);
check(
    "...and indexed into the batch, so the caller knows which song it was",
    banked.map((b) => b.index),
    [0, 1, 2, 3]
);

if (failures.length > 0) {
    console.error(`\n${failures.length} of ${checks} checks FAILED:\n`);
    for (const f of failures) console.error(`  ${f}\n`);
    process.exit(1);
}
console.log(`\n${checks}/${checks} checks passed.`);
console.log("Queries are escaped, misses stay misses, order survives batching, and only a confident match ships.");
