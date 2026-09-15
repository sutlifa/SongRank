// lib/itunes.ts
//
// The song source: the iTunes Search API (free, keyless, no rate-limit key
// to manage) rather than Spotify's Web API. Spotify removed `preview_url`
// from track objects for apps created after Nov 2024, so as of 2026 it
// simply cannot supply a 30-second clip -- iTunes still can, and still does.
// Spotify is used elsewhere in this app (playlist import, ranked-playlist
// export), just never for audio.
//
// Every call here runs server-side only (from /api/songs/search and
// /api/songs/resolve), never from the browser -- partly to keep this file's
// timeout/fallback behaviour in one place, and partly because this sandbox's
// proxy blocks itunes.apple.com outright, which a client-side fetch would
// hit as an opaque, unfixable network error instead of the clean `{results:
// []}` a server route can return instead.
//
// Every function here is a hard "never throw, never surface an upstream
// failure": the matchup UI has a legitimate "no preview available" state for
// this exact reason (songs really do lack previews sometimes), and a 500
// from our own route would make a real, expected condition look like a bug.

import type { SearchResult } from "./types";
import { fixtureSearch, fixtureResolve } from "./fixtures";

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

/** GET /api/songs/search's implementation: free-text search, up to `limit` hits. */
export async function searchSongs(term: string, limit = 15): Promise<SearchResult[]> {
    const q = term.trim();
    if (!q) return [];

    if (fixturesEnabled()) return fixtureSearch(q);

    try {
        const url = `${ITUNES_SEARCH_URL}?term=${encodeURIComponent(q)}&media=music&entity=song&limit=${limit}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok) return [];

        const data = (await res.json()) as { results?: ITunesTrack[] };
        return (data.results ?? [])
            .map(toSearchResult)
            .filter((r): r is SearchResult => r !== null);
    } catch {
        // Network error, timeout, blocked host, malformed JSON -- all of it
        // degrades to "no results" rather than a thrown error. See the file
        // header: this is deliberate, not an oversight.
        return [];
    }
}

/**
 * Resolves one title/artist pair (from a pasted list or a manually typed
 * song) to its best-guess iTunes match, or null when nothing usable was
 * found. Used by /api/songs/resolve to fill in artwork/preview after the
 * review table but before the tournament starts.
 */
export async function resolveSong(title: string, artist: string): Promise<SearchResult | null> {
    const term = artist ? `${title} ${artist}` : title;
    if (!term.trim()) return null;

    if (fixturesEnabled()) return fixtureResolve(title, artist);

    try {
        const url = `${ITUNES_SEARCH_URL}?term=${encodeURIComponent(term)}&media=music&entity=song&limit=5`;
        const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok) return null;

        const data = (await res.json()) as { results?: ITunesTrack[] };
        const results = (data.results ?? []).map(toSearchResult).filter((r): r is SearchResult => r !== null);
        if (results.length === 0) return null;

        // Prefer a result whose artist matches what we were given (loosely --
        // "The Beatles" vs "Beatles"); iTunes's own relevance ranking already
        // did the hard part, so this only breaks ties in an obviously better
        // direction rather than re-implementing search from scratch.
        if (artist.trim()) {
            const needle = artist.trim().toLowerCase();
            const better = results.find(
                (r) =>
                    r.artist.toLowerCase().includes(needle) || needle.includes(r.artist.toLowerCase())
            );
            if (better) return better;
        }

        return results[0];
    } catch {
        return null;
    }
}
