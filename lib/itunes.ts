// lib/itunes.ts
//
// The song source: the iTunes Search API (free, keyless, no rate-limit key
// to manage) rather than Spotify's Web API. Spotify removed `preview_url`
// from track objects for apps created after Nov 2024, so as of 2026 it
// simply cannot supply a 30-second clip -- iTunes still can, and still does.
// SongRank no longer talks to Spotify at all (the playlist import/export
// integration was removed -- editorial playlists are blocked from
// third-party apps, a user-created public playlist also failed to import,
// and export needed a full OAuth dance plus a 25-user cap and a quota
// review to lift), so iTunes is now the only external source in the app.
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

/** See the top of this file and lib/fixtures.ts for why this switch exists. */
function fixturesEnabled(): boolean {
    return process.env.SONGRANK_PREVIEW_FIXTURES === "1";
}

const ITUNES_SEARCH_URL = "https://itunes.apple.com/search";
/** Generous enough for a slow upstream, short enough that a route never hangs the UI. */
const TIMEOUT_MS = 6000;

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
        previewSeconds: typeof t.trackTimeMillis === "number" ? Math.round(t.trackTimeMillis / 1000) : null,
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
    const url = `${ITUNES_SEARCH_URL}?term=${encodeURIComponent(q)}&media=music&entity=song&limit=${limit}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: ITunesTrack[] };
    return (data.results ?? []).map(toSearchResult).filter((r): r is SearchResult => r !== null);
}

/** GET /api/songs/search's implementation: free-text search, up to `limit` hits. */
export async function searchSongs(term: string, limit = 15): Promise<SearchResult[]> {
    if (!term.trim()) return [];
    if (fixturesEnabled()) return fixtureSearch(term);
    try {
        return await rawSearch(term, limit);
    } catch {
        // Network error, timeout, blocked host, malformed JSON -- all of it
        // degrades to "no results" rather than a thrown error. See the file
        // header: this is deliberate, not an oversight.
        return [];
    }
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

const STOPWORDS = new Set(["the", "a", "an", "and", "of", "&"]);
function tokens(s: string): string[] {
    const normalized = normalizeForMatch(s);
    if (!normalized) return [];
    return normalized.split(" ").filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

function coverage(needle: string[], haystack: Set<string>): number {
    if (needle.length === 0) return 0;
    return needle.filter((t) => haystack.has(t)).length / needle.length;
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
export async function resolveSong(title: string, artist: string): Promise<ResolvedMatch | null> {
    const t = title.trim();
    if (!t) return null;

    if (fixturesEnabled()) {
        // Fixtures are a fixed, hand-picked 16-song catalogue matched by
        // exact title or a stable hash fallback (see lib/fixtures.ts) -- there
        // is no ambiguity to score, so every fixture resolution counts as
        // "high".
        return { match: fixtureResolve(title, artist), confidence: "high" };
    }

    const queries = buildResolveQueries(t, artist);
    let best: ResolvedMatch | null = null;

    for (const q of queries) {
        let candidates: SearchResult[];
        try {
            candidates = await rawSearch(q, 5);
        } catch {
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

    if (!best || best.confidence === "none") return null;
    return best;
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
