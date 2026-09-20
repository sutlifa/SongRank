// lib/itunes.ts
//
// The song source: the iTunes Search API (free, keyless, no rate-limit key
// to manage) rather than Spotify's Web API. Spotify removed `preview_url`
// from track objects for apps created after Nov 2024, so as of 2026 it
// simply cannot supply a 30-second clip -- iTunes still can, and still does.
// SongRank does not talk to Spotify at all. Both halves of that integration
// were tried and removed: import, because editorial playlists are blocked
// from third-party apps and a user-created public one failed too; and export,
// because Spotify meters search per APPLICATION and the development-mode
// quota is spent by a single long ranking, locking the app out for most of a
// day. A finished ranking is handed to a playlist converter instead (see
// components/PlaylistHandoff.tsx), so iTunes is the only external source
// left in the app.
//
// Every call here runs server-side only (from /api/songs/search,
// /api/songs/resolve and /api/songs/suggest), never from the browser --
// partly to keep this file's timeout/fallback behaviour in one place, and
// partly because this sandbox's proxy blocks itunes.apple.com outright,
// which a client-side fetch would hit as an opaque, unfixable network error
// instead of the clean `{results: []}` a server route can return instead.
//
// Every function here is a hard "never throw, never surface an upstream
// failure": the matchup UI has a legitimate "no preview available" state for
// this exact reason (songs really do lack previews sometimes), and a 500
// from our own route would make a real, expected condition look like a bug.

import type { SearchResult } from "./types";
// ".ts" extension needed here (a value import, unlike the type-only one
// above) so this file is directly runnable under node's
// --experimental-strip-types -- see scripts/verify-parse.ts's optional
// SONGRANK_PREVIEW_FIXTURES integration check, which imports this module
// standalone rather than through Next's bundler.
import { fixtureSearch, fixtureResolve } from "./fixtures.ts";
// normalizeForMatch is the same normalization lib/parse.ts uses to score a
// catalogue hit against a pasted line (NFD-strip diacritics, fold
// punctuation to spaces, drop a trailing feat./ft. clause) -- reused rather
// than reimplemented so "Auli'i Cravalho" and "4*TOWN" tokenize identically
// everywhere in the app instead of almost-identically in two places that
// drift apart. MatchConfidence is a type-only import: lib/parse.ts never
// imports this file, so pulling its type in here creates no cycle.
import { normalizeForMatch, type MatchConfidence } from "./parse.ts";
import { someWordMatches } from "./fuzzy.ts";

/** See the top of this file and lib/fixtures.ts for why this switch exists. */
function fixturesEnabled(): boolean {
    return process.env.SONGRANK_PREVIEW_FIXTURES === "1";
}

const ITUNES_SEARCH_URL = "https://itunes.apple.com/search";
/** Generous enough for a slow upstream, short enough that a route never hangs the UI. */
const TIMEOUT_MS = 6000;

/**
 * Apple did not answer -- as opposed to answering "nothing matches".
 *
 * These are not the same outcome and must never be collapsed into one, which
 * is exactly what `if (!res.ok) return []` used to do. A 429 from Apple's rate
 * limiter came back through the whole pipeline as "this track is not in the
 * catalogue", the song was labelled "No preview available for this track", and
 * nothing anywhere said otherwise. The bug is invisible by construction: the
 * user sees a plausible, permanent-sounding explanation for a track they can
 * find in iTunes themselves.
 *
 * Rate limiting is not hypothetical here. One 30-song paste is up to four
 * cascade queries per song across several concurrent workers -- a burst of
 * hundreds of requests -- and Apple's search endpoint is metered per IP. The
 * songs that miss are whichever ones happened to land after the limiter
 * engaged, which is why it presents as "some songs" rather than a clean
 * failure.
 */
export class UpstreamUnavailableError extends Error {
    /** Written out longhand rather than as a TypeScript parameter property:
     * the verify scripts run under `node --experimental-strip-types`, which
     * rejects that syntax outright. Next's compiler accepts it, so the
     * shorthand builds fine and breaks every script in scripts/ instead. */
    readonly reason: string;

    constructor(reason: string) {
        super(`iTunes lookup failed: ${reason}`);
        this.name = "UpstreamUnavailableError";
        this.reason = reason;
    }
}

/** Attempts per query, including the first. */
const MAX_ATTEMPTS = 3;
/** Base backoff; doubled each attempt, and overridden by `Retry-After`. */
const RETRY_BASE_MS = 400;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `Retry-After` in milliseconds, when the server sent a usable one.
 *
 * Honouring it matters more than the backoff curve: a limiter that says "wait
 * two seconds" and gets hammered again at 400ms extends the penalty, so
 * ignoring the header makes the problem it signals worse.
 */
function retryAfterMs(res: Response): number | null {
    const header = res.headers.get("retry-after");
    if (!header) return null;
    const seconds = Number(header);
    // A numeric header is answered as a number either way, valid or not.
    // Falling through to the date branch on a negative one let
    // Date.parse("-5") succeed as a year and produce an immediate retry,
    // which extends the very penalty this function exists to serve.
    //
    // The cap is fine HERE, unlike in the Spotify client this once mirrored:
    // this value is only ever slept on, never shown to anyone. Capping a
    // number that a person reads as "come back in N minutes" is what made a
    // 23-hour lockout announce itself as five minutes.
    if (Number.isFinite(seconds)) return seconds >= 0 ? Math.min(seconds * 1000, 10_000) : null;
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.min(Math.max(date - Date.now(), 0), 10_000);
    return null;
}

interface ITunesTrack {
    trackName?: string;
    artistName?: string;
    collectionName?: string;
    artworkUrl100?: string;
    previewUrl?: string;
    trackTimeMillis?: number;
    trackId?: number;
}

/** iTunes serves 100x100 artwork by default; the URL pattern accepts other sizes. */
function upgradeArtwork(url: string | undefined): string | null {
    if (!url) return null;
    return url.replace("100x100bb", "300x300bb");
}

function toSearchResult(t: ITunesTrack): SearchResult | null {
    if (!t.trackName || !t.artistName) return null;
    return {
        title: t.trackName,
        artist: t.artistName,
        album: t.collectionName ?? null,
        artworkUrl: upgradeArtwork(t.artworkUrl100),
        previewUrl: t.previewUrl ?? null,
        // Deliberately null, and never `trackTimeMillis / 1000`.
        //
        // `trackTimeMillis` is the length of the WHOLE TRACK, not of the
        // preview file. Using it here reported a 3.5-minute song as a
        // 210-second "preview", and ClipPlayer starts its clip a quarter of
        // the way in -- so it seeked to 52 seconds inside a file that is only
        // 30 seconds long. The browser answers a seek past the end by firing
        // `ended`, which showed as a full progress bar and no audio, and the
        // failure scaled with song length so it looked erratic rather than
        // systematic. Fixtures hardcode a correct 30, so no offline test could
        // ever catch it.
        //
        // The search API does not report preview length at all, so the honest
        // value is "unknown": ClipPlayer reads the real duration off the audio
        // element once metadata loads, which is authoritative in a way nothing
        // in this response is.
        previewSeconds: null,
        itunesId: typeof t.trackId === "number" ? t.trackId : null,
    };
}

/**
 * The one place that actually calls itunes.apple.com. `searchSongs` (the
 * free-text search endpoint) and the resolve/suggest cascade below both
 * funnel through this -- fixture-switching and each caller's own "never
 * throw" contract live in the callers, not here, so this stays a plain
 * HTTP-in/results-out function that either of them can reuse.
 */
async function rawSearch(term: string, limit: number): Promise<SearchResult[]> {
    const q = term.trim();
    if (!q) return [];
    // encodeURIComponent leaves `*`, `'`, `!`, `~`, `(`, `)` unescaped (RFC
    // 3986's "unreserved" set) -- exactly the characters real Disney credits
    // throw at this ("4*TOWN", "Auli'i Cravalho", "Keali'i Ho'omalu"). That's
    // fine: none of them are meaningful URL delimiters, so passing them
    // through verbatim is correct, not a bug to work around.
    // `explicit=Yes` is stated rather than left to the default, which is what
    // Apple documents today. SongRank does not filter music by content and
    // should not start doing so by accident: this is a tool for ranking
    // whatever songs someone chose, and quietly dropping half an artist's
    // catalogue would be both wrong and invisible -- the track simply would
    // not turn up, with nothing to say why. Writing the parameter down means a
    // change to Apple's default cannot silently impose a policy we never
    // decided on.
    const url =
        `${ITUNES_SEARCH_URL}?term=${encodeURIComponent(q)}` +
        `&media=music&entity=song&explicit=Yes&limit=${limit}`;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        let res: Response;
        try {
            res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        } catch (err) {
            // A timeout or a dropped connection. Worth another go; the last
            // one tells the caller we never got an answer.
            if (attempt === MAX_ATTEMPTS) {
                throw new UpstreamUnavailableError(err instanceof Error ? err.message : "network error");
            }
            await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
            continue;
        }

        if (res.ok) {
            const data = (await res.json()) as { results?: ITunesTrack[] };
            return (data.results ?? []).map(toSearchResult).filter((r): r is SearchResult => r !== null);
        }

        // 429 is the one that actually bites, and 5xx is Apple having a
        // moment: both mean "ask again", not "no such song".
        const retryable = res.status === 429 || res.status >= 500;
        if (!retryable) {
            // A genuine 4xx is us asking a malformed question. Retrying an
            // unanswerable query just spends the rate limit that the next
            // song needs, so this really is an empty result.
            return [];
        }
        if (attempt === MAX_ATTEMPTS) throw new UpstreamUnavailableError(`HTTP ${res.status}`);
        await sleep(retryAfterMs(res) ?? RETRY_BASE_MS * 2 ** (attempt - 1));
    }

    // Unreachable: every path above either returns or throws on the last
    // attempt. Here so the function is provably total rather than relying on
    // the loop bound.
    throw new UpstreamUnavailableError("retries exhausted");
}

export interface SearchOutcome {
    /** Exact-term hits first, then anything a broader term added. */
    results: SearchResult[];
    /** The term as typed, trimmed. */
    term: string;
    /**
     * The broader term that was also searched, or null if the exact one was
     * enough on its own. Shown by the caller so a widened search never passes
     * itself off as an exact one.
     */
    broadenedTo: string | null;
    /** How many of `results` came from the exact term. Lets the UI say
     * "nothing matched exactly" versus "here's more" without guessing. */
    exactCount: number;
    /**
     * True when Apple never answered -- a timeout, or a rate limit that
     * survived every retry. Same distinction as `ResolveOutcome.unreachable`
     * and for the same reason: an empty `results` array means "nothing
     * matched", and reporting an outage that way tells someone their song
     * does not exist when it plainly does.
     *
     * This path matters more than it looks. It backs the Search tab, the
     * pre-flight screen's per-song "Change version" box, AND the catalogue
     * matching pass that runs over a whole pasted list (see
     * `resolveImportBatch` in lib/parse.ts) -- so a throttled search degrades
     * a bulk import too, silently, and looked exactly like a list of songs
     * Apple had never heard of.
     */
    unreachable: boolean;
}

/** Parenthesised or bracketed matter ANYWHERE, not just at the end -- "Song
 * (Live) [Explicit]" and "Song (Remastered) - Single" both need this. */
const PAREN_ANYWHERE_RE = /[([{][^)\]}]*[)\]}]/g;
/** A trailing " - Slaughter Mix" / " – 2009 Remaster" style suffix. */
const DASH_SUFFIX_RE = /\s+[-–—]\s+[^-–—]*$/;

/**
 * Terms to try for one search, narrowest first.
 *
 * Apple indexes a track under the exact title its label submitted, so anything
 * a person half-remembers -- a remix name, a version marker, an "(Explicit)"
 * tag -- can match nothing at all while the base title returns plenty,
 * including the recording they were actually after under a name they would
 * never have guessed. The ladder strips the parts most likely to be wrong,
 * in the order they are most likely to be wrong.
 *
 * Capped at three terms, and the caller stops early once it has enough. That
 * bound is deliberate: this same code path backs the catalogue matching pass
 * over a whole pasted list, so an unbounded ladder would multiply a 200-song
 * import straight into Apple's rate limiter.
 */
function searchFallbacks(term: string): string[] {
    const trimmed = term.trim();
    const out = [trimmed];

    const noParens = trimmed.replace(PAREN_ANYWHERE_RE, " ").replace(/\s+/g, " ").trim();
    if (noParens && noParens !== trimmed) out.push(noParens);

    // Only worth dropping a dash suffix if a usable query survives it -- "Cher
    // - Believe" must not degrade to "Cher".
    const base = noParens || trimmed;
    const noDash = base.replace(DASH_SUFFIX_RE, "").trim();
    if (noDash && noDash !== base && noDash.split(/\s+/).length >= 2) out.push(noDash);

    return Array.from(new Set(out.filter(Boolean))).slice(0, 3);
}

/**
 * Enough hits that broadening would add noise rather than help.
 *
 * The old rule was "stop at the first term that returns anything at all",
 * which meant a single junk hit for an over-specific query blocked the
 * broader search entirely -- you got one wrong answer instead of the right
 * one plus some near misses. A handful is the point at which someone has
 * something to choose between.
 */
const ENOUGH_RESULTS = 5;

/** Same song twice across two queries, which is the normal case once the
 * ladder broadens. Keyed on the iTunes id where there is one, and on the text
 * otherwise, so a fixture or an id-less row still de-duplicates. */
function resultKey(r: SearchResult): string {
    return r.itunesId !== null ? `id:${r.itunesId}` : `t:${r.title.toLowerCase()}|${r.artist.toLowerCase()}`;
}

/**
 * GET /api/songs/search's implementation: free-text search, up to `limit` hits.
 *
 * 25 rather than 15: for a title other people have also recorded, the first
 * page is routinely karaoke and tribute versions, and the recording someone is
 * actually looking for can sit below a shorter cut-off. Same reasoning as
 * RESOLVE_CANDIDATES, on the list a human scans rather than the one we score.
 *
 * Unlike the resolve cascade, this used to send exactly what was typed and
 * stop. So the search box dead-ended on a title Apple spells differently,
 * showing "No results" for a song whose base title returns a page of them --
 * the one screen where a person could have picked the right version out
 * themselves, if only they had been shown it.
 */
export async function searchSongs(term: string, limit = 25): Promise<SearchOutcome> {
    const typed = term.trim();
    const empty = (unreachable = false): SearchOutcome => ({
        results: [],
        term: typed,
        broadenedTo: null,
        exactCount: 0,
        unreachable,
    });
    if (!typed) return empty();
    if (fixturesEnabled()) {
        const results = fixtureSearch(typed);
        return { results, term: typed, broadenedTo: null, exactCount: results.length, unreachable: false };
    }

    const seen = new Set<string>();
    const results: SearchResult[] = [];
    let unreachable = false;
    let exactCount = 0;
    let broadenedTo: string | null = null;

    for (const [index, q] of searchFallbacks(typed).entries()) {
        // Results ACCUMULATE rather than the first non-empty query winning.
        // An over-specific query that returns one poor hit used to stop the
        // ladder dead; now its hit stays at the top and the broader terms fill
        // in underneath it.
        if (results.length >= ENOUGH_RESULTS) break;
        try {
            const hits = await rawSearch(q, limit);
            if (index > 0 && hits.length > 0 && broadenedTo === null) broadenedTo = q;
            for (const hit of hits) {
                const key = resultKey(hit);
                if (seen.has(key)) continue;
                seen.add(key);
                results.push(hit);
            }
            if (index === 0) exactCount = results.length;
        } catch (err) {
            // Remembered rather than swallowed, so an empty result at the end
            // can still say whether Apple ever answered.
            if (err instanceof UpstreamUnavailableError) unreachable = true;
        }
    }

    return {
        results: results.slice(0, limit),
        term: typed,
        broadenedTo,
        exactCount,
        // Only meaningful when we came away with nothing: a partial outage
        // that still produced results is not worth telling anyone about.
        unreachable: results.length === 0 && unreachable,
    };
}

// ---------------------------------------------------------------------------
// Query cascade for resolveSong/suggestMatches -- problem A.
//
// The old code searched `${title} ${artist}` verbatim. With an ensemble
// credit ("We Don't Talk About Bruno" - Carolina Gaitan, Mauro Castillo,
// Adassa, Rhenzy Feliz, Diane Guerrero, Stephanie Beatriz & Encanto Cast)
// that query is the title plus seven performer names, ~120 characters, and
// iTunes returns nothing for it -- not because the track is missing from
// the catalogue, but because we asked it an unanswerable question. The fix
// isn't one better query, it's a small ladder of narrower ones, tried in
// order and stopped as soon as one scores well.
// ---------------------------------------------------------------------------

/**
 * Separators that introduce a second (or third, ...) credited performer:
 * comma, ampersand, feat./ft./featuring, "with", or a bare "x" (as in
 * "Marshmello x Bastille"). Word-bounded so it doesn't fire inside a name.
 */
const ARTIST_SPLIT_RE = /\s*(?:,|&|\bfeat\.?\b|\bfeaturing\b|\bft\.?\b|\bwith\b|\bx\b)\s*/i;

/**
 * The first credited performer on an artist string -- "Carolina Gaitan,
 * Mauro Castillo, ... & Encanto Cast" -> "Carolina Gaitan". This is almost
 * always the lead vocalist on a Disney ensemble number, and searching for
 * just them (instead of the whole credit list) is what actually finds the
 * track.
 */
export function primaryArtist(artist: string): string {
    const trimmed = artist.trim();
    if (!trimmed) return "";
    return trimmed.split(ARTIST_SPLIT_RE)[0].trim();
}

/** Every individually-credited performer, in order -- feeds the "generic primary" fallback below. */
function artistSegments(artist: string): string[] {
    const trimmed = artist.trim();
    if (!trimmed) return [];
    return trimmed
        .split(ARTIST_SPLIT_RE)
        .map((s) => s.trim())
        .filter(Boolean);
}

/**
 * A credit that names a group role rather than a person -- "Encanto Cast",
 * "The Dwarf Chorus", "The Muses", "Disney Studio Chorus". These are nearly
 * useless as search terms (they rarely match iTunes's per-track artist
 * metadata, which usually names actual singers or the film's soundtrack
 * artist), so the cascade prefers title-only queries over spending a request
 * on one of these as the primary artist.
 */
const GENERIC_CREDIT_RE = /\b(cast|chorus|ensemble|orchestra|choir|muses|company|players)\b/i;
function isGenericCredit(s: string): boolean {
    return Boolean(s) && GENERIC_CREDIT_RE.test(s);
}

/** A trailing "(Jim's Theme)" / "[Song of the Ancestors]" parenthetical, stripped for a title-only query. */
const PAREN_SUFFIX_RE = /\s*[([][^()[\]]*[)\]]\s*$/;
function stripParenthetical(title: string): string {
    return title.replace(PAREN_SUFFIX_RE, "").trim();
}

/**
 * Builds the ladder of queries to try, narrowest-useful-first, for one
 * title/artist pair. Exported (rather than folded into resolveSong) so
 * scripts/verify-resolve.ts can assert on the actual query strings offline,
 * with no network call.
 *
 *   1. title + primary artist
 *   2. title (parenthetical stripped) + primary artist
 *   3. title alone
 *   4. title (parenthetical stripped) alone
 *   5. title + a later, non-generic credit -- only when the primary credit
 *      is itself generic ("Cast", "Chorus", ...) and a better one exists
 *      further down the artist string.
 *
 * Deduplicated and order-preserving: a short title with no parenthetical and
 * no artist collapses to a single query, which is the common case and the
 * one that has to stay close to one request per song.
 */
export function buildResolveQueries(title: string, artist: string): string[] {
    const trimmedTitle = title.trim();
    const strippedTitle = stripParenthetical(trimmedTitle);
    const segments = artistSegments(artist);
    const primary = segments[0] ?? "";
    const primaryGeneric = isGenericCredit(primary);

    const queries: string[] = [];
    if (primary && !primaryGeneric) {
        queries.push(`${trimmedTitle} ${primary}`);
        if (strippedTitle !== trimmedTitle) queries.push(`${strippedTitle} ${primary}`);
    }
    queries.push(trimmedTitle);
    if (strippedTitle !== trimmedTitle) queries.push(strippedTitle);

    if (primaryGeneric) {
        const distinctiveLater = segments.slice(1).find((s) => !isGenericCredit(s));
        if (distinctiveLater) queries.push(`${strippedTitle || trimmedTitle} ${distinctiveLater}`);
    }

    // Dedup while preserving first-seen order -- e.g. a title with no
    // parenthetical and no usable artist produces the same string twice
    // above.
    return Array.from(new Set(queries.map((q) => q.trim()).filter(Boolean)));
}

/**
 * How many hits each query in the cascade pulls back to score.
 *
 * This was 5, which is too few for a title other people have also recorded.
 * iTunes ranks by its own relevance, and for a well-covered song the first
 * few hits are routinely karaoke versions, tribute albums and unrelated
 * tracks that happen to share a word -- so the recording actually being
 * looked for can sit outside the top 5 and never get scored at all. The
 * symptom is a song that "isn't on iTunes" when it plainly is.
 *
 * Widening the pool cannot make a match worse: `scoreCandidate` picks the
 * best of whatever comes back, and the loop still stops at the first "high".
 * It costs a slightly larger response on the same number of requests.
 */
const RESOLVE_CANDIDATES = 20;

const STOPWORDS = new Set(["the", "a", "an", "and", "of", "&"]);
function tokens(s: string): string[] {
    const normalized = normalizeForMatch(s);
    if (!normalized) return [];
    return normalized.split(" ").filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

/**
 * What fraction of `needle`'s words are present in `haystack`, counting a
 * near-miss as present -- see lib/fuzzy.ts for how near, and for the
 * "Chicken Huntin'" / "Chickin 'Pluckin' Huntin Remix" case that made exact
 * equality untenable here.
 *
 * Note where the tolerance is and is not: this decides whether a candidate
 * ALREADY RETURNED by the catalogue is a good enough match to offer. It
 * cannot summon a result Apple didn't send, and it is not used by the
 * results-page filter, which has different incentives entirely
 * (lib/songFilter.ts says why).
 */
function coverage(needle: string[], haystack: Set<string>): number {
    if (needle.length === 0) return 0;
    // A Set was the right shape when this was an equality test and is kept
    // because callers build it once for several coverage() calls; the scan
    // below is over at most a handful of words either way.
    return needle.filter((t) => someWordMatches(t, haystack)).length / needle.length;
}

/**
 * Scores an iTunes candidate against the title/artist we actually asked
 * about (not against whichever narrowed query happened to find it) -- so a
 * hit surfaced by a title-only query still gets full credit for an artist
 * match if one is there, and a hit whose artist metadata simply doesn't
 * overlap our (possibly huge, possibly generic) credit string isn't
 * penalized for that alone.
 *
 * Artist coverage is checked in both directions on purpose:
 *   - primary-vs-candidate: does the candidate's own artist field contain
 *     the *first* credited performer we were given? ("Carolina Gaitan" in
 *     "Carolina Gaitan, Mauro Castillo, ...")
 *   - candidate-vs-full: does the *candidate's* (usually short) artist name
 *     appear inside the *full* credit string we were given? ("The Dwarf
 *     Chorus" contains "chorus", which a soundtrack's real artist field
 *     often does too)
 * The better of the two wins, since either one on its own is a real signal.
 */
export function scoreCandidate(
    target: { title: string; artist: string },
    candidate: { title: string; artist: string }
): MatchConfidence {
    const targetTitleTokens = tokens(stripParenthetical(target.title));
    const candidateTitleHay = new Set(tokens(candidate.title));
    const titleCoverage = coverage(targetTitleTokens, candidateTitleHay);

    const primary = primaryArtist(target.artist);
    const candidateArtistHay = new Set(tokens(candidate.artist));
    const primaryCoverage = primary ? coverage(tokens(primary), candidateArtistHay) : 0;

    const targetArtistHay = new Set(tokens(target.artist));
    const candidateVsFullCoverage = target.artist.trim() ? coverage(tokens(candidate.artist), targetArtistHay) : 0;

    const artistCoverage = Math.max(primaryCoverage, candidateVsFullCoverage);
    // No artist to compare against at all (a title-only entry): judge on
    // title alone rather than letting a forced 0 artist score drag every
    // candidate down to "none".
    const artistOk = !target.artist.trim() || artistCoverage >= 0.5;

    if (titleCoverage >= 0.7 && artistOk) return "high";
    if (titleCoverage >= 0.4 || artistCoverage >= 0.4) return "partial";
    return "none";
}

function confidenceRank(c: MatchConfidence): number {
    return c === "high" ? 2 : c === "partial" ? 1 : 0;
}

export interface ResolvedMatch {
    match: SearchResult;
    confidence: MatchConfidence;
}

/**
 * Resolves one title/artist pair (from a pasted list or a manually typed
 * song) to its best-guess iTunes match, or null when nothing usable was
 * found. Used by /api/songs/resolve to fill in artwork/preview after the
 * review table but before the tournament starts.
 *
 * Runs the query cascade one request at a time -- never in parallel per
 * song, see the file header on Apple's rate limits -- stopping the moment a
 * "high"-confidence hit turns up so a clean list still costs close to one
 * request per song. Only escalates to a broader query when the current one
 * came back empty or scored "partial" or worse.
 */
/**
 * The outcome of a resolution attempt. Always an object, never null, because
 * "found nothing" and "never got an answer" are different facts and a bare
 * null cannot tell them apart -- which is precisely how a rate-limited lookup
 * came to be displayed as "No preview available for this track."
 */
export interface ResolveOutcome {
    /** The best candidate found, or null if there wasn't one. */
    match: SearchResult | null;
    /** Always "none" when `match` is null. */
    confidence: MatchConfidence;
    /**
     * True when at least one query in the cascade failed to get an answer from
     * Apple at all -- a timeout, a dropped connection, or a rate limit that
     * survived every retry. A caller showing this to a person must say
     * something different from a clean miss: the track may well exist, we just
     * never managed to ask.
     */
    unreachable: boolean;
}

export async function resolveSong(title: string, artist: string): Promise<ResolveOutcome> {
    const t = title.trim();
    const miss = (unreachable = false): ResolveOutcome => ({ match: null, confidence: "none", unreachable });
    if (!t) return miss();

    if (fixturesEnabled()) {
        // Fixtures are a fixed, hand-picked 16-song catalogue matched by
        // exact title or a stable hash fallback (see lib/fixtures.ts) -- there
        // is no ambiguity to score, so every fixture resolution counts as
        // "high".
        return { match: fixtureResolve(title, artist), confidence: "high", unreachable: false };
    }

    const queries = buildResolveQueries(t, artist);
    let best: ResolvedMatch | null = null;
    let unreachable = false;

    for (const q of queries) {
        let candidates: SearchResult[];
        try {
            candidates = await rawSearch(q, RESOLVE_CANDIDATES);
        } catch (err) {
            // Remembered, not swallowed. Every query in the cascade can fail
            // this way, and if they all do we have learned nothing about the
            // song -- which is a different report from "Apple has no such
            // track", and the only one that tells the user it is worth trying
            // again.
            if (err instanceof UpstreamUnavailableError) unreachable = true;
            candidates = [];
        }
        for (const candidate of candidates) {
            const confidence = scoreCandidate({ title: t, artist }, candidate);
            if (!best || confidenceRank(confidence) > confidenceRank(best.confidence)) {
                best = { match: candidate, confidence };
            }
        }
        if (best && best.confidence === "high") break;
    }

    if (!best || best.confidence === "none") return miss(unreachable);
    // A usable match found despite an earlier hiccup is just a match; the
    // flag only means anything when we came away empty-handed.
    return { match: best.match, confidence: best.confidence, unreachable: false };
}

export interface SuggestedMatch {
    result: SearchResult;
    confidence: MatchConfidence;
}

/**
 * Pre-flight problem B: for a song with no preview or only a weak match,
 * this returns a small, ranked pool of candidate tracks instead of making
 * the user retype a search from scratch. Reuses the same query cascade as
 * resolveSong (the title-only queries are exactly what surfaces a track
 * whose credited-artist string didn't match), but pools and dedupes results
 * across a few queries instead of short-circuiting on the first hit, since
 * the point here is *choices*, not a single best guess.
 *
 * Capped to the first 3 cascade queries -- this only ever runs for songs
 * that already failed (or scored weakly on) the single-query resolve pass,
 * and it runs once per unmatched song as the pre-flight screen paginates
 * them into view, so keeping it to a couple of requests per song matters
 * more here than in resolveSong's already-short common case.
 */
export async function suggestMatches(title: string, artist: string, limit = 5): Promise<SuggestedMatch[]> {
    const t = title.trim();
    if (!t) return [];

    if (fixturesEnabled()) {
        const direct = fixtureSearch(`${t} ${artist}`.trim());
        const pool = direct.length > 0 ? direct : fixtureSearch(t);
        return pool.slice(0, limit).map((result) => ({ result, confidence: scoreCandidate({ title: t, artist }, result) }));
    }

    const queries = buildResolveQueries(t, artist).slice(0, 3);
    const seen = new Map<string, SuggestedMatch>();

    for (const q of queries) {
        let candidates: SearchResult[];
        try {
            candidates = await rawSearch(q, 8);
        } catch {
            candidates = [];
        }
        for (const candidate of candidates) {
            const key = candidate.itunesId != null ? `id:${candidate.itunesId}` : `${candidate.title}|${candidate.artist}`;
            if (seen.has(key)) continue;
            seen.set(key, { result: candidate, confidence: scoreCandidate({ title: t, artist }, candidate) });
        }
        // A healthy-sized pool to rank from already -- no need to spend the
        // remaining cascade queries once we have plenty of raw candidates.
        if (seen.size >= limit * 3) break;
    }

    return Array.from(seen.values())
        .sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence))
        .slice(0, limit);
}
