// lib/spotify.ts
//
// Two unrelated uses of the Spotify Web API, deliberately kept in one file
// because they're the app's only two Spotify touchpoints and share the same
// client id/secret:
//
//   1. Playlist import (client-credentials flow): reads a *public* playlist's
//      track list with just SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET -- no
//      user has to sign in with Spotify to import their playlist. This is
//      the app credentials talking to Spotify about Spotify's own public
//      data, not about any person.
//   2. Ranked-playlist export (authorization-code flow): needs a real
//      Spotify *user* to grant playlist-write scopes, so it's a normal OAuth
//      redirect dance (see /api/spotify/connect and /api/spotify/callback).
//
// Neither path ever supplies audio: see lib/itunes.ts's header for why
// Spotify previews are off the table entirely as of 2026.

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_BASE = "https://api.spotify.com/v1";
const TIMEOUT_MS = 8000;

export function isSpotifyConfigured(): boolean {
    return Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
}

/**
 * Export additionally needs a registered redirect URI (the OAuth dance has
 * to send the user's browser somewhere), which import never does -- so a
 * deployment can have import working without export being ready yet.
 */
export function isSpotifyExportConfigured(): boolean {
    return isSpotifyConfigured() && Boolean(process.env.SPOTIFY_REDIRECT_URI);
}

/**
 * Cookie names shared by /api/spotify/connect, /callback and /export.
 *
 * The access token lives in a short-lived, httpOnly cookie -- never in the
 * database, never sent to a client component -- because it's a bearer
 * credential for someone's real Spotify account and this app has no
 * business persisting it past the one export action it's used for.
 */
export const SPOTIFY_STATE_COOKIE = "sr_spotify_state";
export const SPOTIFY_RETURN_TO_COOKIE = "sr_spotify_return_to";
export const SPOTIFY_TOKEN_COOKIE = "sr_spotify_token";

// ---------------------------------------------------------------------------
// Client-credentials flow (playlist import)
// ---------------------------------------------------------------------------

/**
 * Module-scope cache for the app-level (client-credentials) token.
 *
 * This is a *best-effort* optimization, not a correctness requirement: a
 * Vercel Function instance is ephemeral (see AGENTS.md's Vercel guidance),
 * so this cache is empty as often as not and every path below still works
 * correctly on a cold miss -- it just costs one extra token request. Never
 * treat this module as a place to keep state that matters.
 */
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getClientCredentialsToken(): Promise<string | null> {
    if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;

    const id = process.env.SPOTIFY_CLIENT_ID;
    const secret = process.env.SPOTIFY_CLIENT_SECRET;
    if (!id || !secret) return null;

    try {
        const res = await fetch(TOKEN_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
            },
            body: "grant_type=client_credentials",
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) {
            // Logged, not swallowed. A wrong client secret and a transient
            // Spotify outage both used to reach the user as the same "could
            // not read that playlist", with nothing written down anywhere --
            // leaving no way to tell a configuration mistake from an upstream
            // blip. Spotify's error body names the cause ("invalid_client"
            // for bad credentials); it carries no user data and no part of
            // our secret, so it is safe in a server log.
            const detail = await res.text().catch(() => "<unreadable body>");
            console.error("SPOTIFY TOKEN ERROR:", res.status, detail.slice(0, 300));
            return null;
        }

        const data = (await res.json()) as { access_token: string; expires_in: number };
        // Shave 30s off the reported lifetime so a request that starts near
        // the edge of expiry doesn't get a token that dies mid-flight.
        cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 30) * 1000 };
        return data.access_token;
    } catch (err) {
        console.error("SPOTIFY TOKEN REQUEST FAILED:", err);
        return null;
    }
}

/**
 * Accepts a full playlist URL, a `spotify:playlist:...` URI, or a bare id,
 * and returns just the id. Returns null for anything that isn't recognizably
 * a playlist reference, so the route can give an honest "that doesn't look
 * like a playlist link" instead of a confusing upstream 400.
 */
export function parsePlaylistId(input: string): string | null {
    const trimmed = input.trim();

    const uriMatch = trimmed.match(/^spotify:playlist:([A-Za-z0-9]+)$/);
    if (uriMatch) return uriMatch[1];

    try {
        const url = new URL(trimmed);
        if (!url.hostname.endsWith("spotify.com")) return null;
        const parts = url.pathname.split("/").filter(Boolean);
        const idx = parts.indexOf("playlist");
        if (idx !== -1 && parts[idx + 1]) return parts[idx + 1];
        return null;
    } catch {
        // Not a URL -- accept a bare id if it looks like one (Spotify ids are
        // base62, 22 characters).
        return /^[A-Za-z0-9]{22}$/.test(trimmed) ? trimmed : null;
    }
}

export interface SpotifyPlaylistTrack {
    title: string;
    artist: string;
    album: string | null;
    spotifyUri: string;
}

interface SpotifyTrackItem {
    track: {
        name: string;
        uri: string;
        artists: { name: string }[];
        album: { name: string } | null;
    } | null;
}

/**
 * Reads every track in a public playlist, paginating through Spotify's
 * `next` links. Local files and region-blocked tracks come back with
 * `track: null` and are skipped rather than crashing the import.
 *
 * Returns a discriminated result rather than `tracks | null` so the route can
 * tell the user something true. Every distinct failure here -- credentials
 * Spotify rejects, a playlist genuinely not visible to an app, rate limiting,
 * an outage -- used to arrive as the same bare `null` and therefore the same
 * "make sure it's public" message, which is actively misleading when the
 * playlist is public and the real problem is the client secret.
 */
export type PlaylistFetchResult =
    | { ok: true; tracks: SpotifyPlaylistTrack[] }
    | {
          ok: false;
          reason: "no-token" | "not-found" | "forbidden" | "rate-limited" | "upstream";
          status: number;
      };

export async function getPlaylistTracks(playlistId: string): Promise<PlaylistFetchResult> {
    const token = await getClientCredentialsToken();
    if (!token) return { ok: false, reason: "no-token", status: 0 };

    const tracks: SpotifyPlaylistTrack[] = [];
    let url: string | null =
        `${API_BASE}/playlists/${encodeURIComponent(playlistId)}/tracks` +
        `?fields=items(track(name,uri,artists(name),album(name))),next&limit=100`;

    try {
        while (url) {
            const res: Response = await fetch(url, {
                headers: { Authorization: `Bearer ${token}` },
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            if (!res.ok) {
                // Partial reads still count: a long playlist that dies on page
                // three is better delivered short than thrown away entirely.
                if (tracks.length > 0) return { ok: true, tracks };

                const detail = await res.text().catch(() => "<unreadable body>");
                console.error("SPOTIFY PLAYLIST READ ERROR:", res.status, playlistId, detail.slice(0, 300));
                return {
                    ok: false,
                    reason:
                        res.status === 404
                            ? "not-found"
                            : res.status === 401 || res.status === 403
                              ? "forbidden"
                              : res.status === 429
                                ? "rate-limited"
                                : "upstream",
                    status: res.status,
                };
            }

            const data = (await res.json()) as { items: SpotifyTrackItem[]; next: string | null };
            for (const item of data.items) {
                if (!item.track) continue;
                tracks.push({
                    title: item.track.name,
                    artist: item.track.artists.map((a) => a.name).join(", "),
                    album: item.track.album?.name ?? null,
                    spotifyUri: item.track.uri,
                });
            }
            url = data.next;
        }
        return { ok: true, tracks };
    } catch (err) {
        // A failure partway through a long playlist still returns whatever
        // was read so far rather than throwing it all away.
        if (tracks.length > 0) return { ok: true, tracks };
        console.error("SPOTIFY PLAYLIST REQUEST FAILED:", playlistId, err);
        return { ok: false, reason: "upstream", status: 0 };
    }
}

// ---------------------------------------------------------------------------
// Authorization-code flow (export to a ranked playlist)
// ---------------------------------------------------------------------------

export const SPOTIFY_EXPORT_SCOPES = "playlist-modify-public playlist-modify-private";

export function buildAuthorizeUrl(state: string, redirectUri: string): string | null {
    const id = process.env.SPOTIFY_CLIENT_ID;
    if (!id) return null;
    const params = new URLSearchParams({
        response_type: "code",
        client_id: id,
        scope: SPOTIFY_EXPORT_SCOPES,
        redirect_uri: redirectUri,
        state,
    });
    return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

export interface SpotifyUserToken {
    accessToken: string;
    /** Seconds since epoch. */
    expiresAt: number;
}

export async function exchangeCodeForToken(code: string, redirectUri: string): Promise<SpotifyUserToken | null> {
    const id = process.env.SPOTIFY_CLIENT_ID;
    const secret = process.env.SPOTIFY_CLIENT_SECRET;
    if (!id || !secret) return null;

    try {
        const res = await fetch(TOKEN_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
            },
            body: new URLSearchParams({
                grant_type: "authorization_code",
                code,
                redirect_uri: redirectUri,
            }).toString(),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) return null;

        const data = (await res.json()) as { access_token: string; expires_in: number };
        return { accessToken: data.access_token, expiresAt: Math.floor(Date.now() / 1000) + data.expires_in };
    } catch {
        return null;
    }
}

async function spotifyMe(accessToken: string): Promise<{ id: string } | null> {
    try {
        const res = await fetch(`${API_BASE}/me`, {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) return null;
        return (await res.json()) as { id: string };
    } catch {
        return null;
    }
}

/** Best-effort search for one ranked song's Spotify URI, for the export step. */
export async function searchTrackUri(accessToken: string, title: string, artist: string): Promise<string | null> {
    try {
        const q = encodeURIComponent(`track:${title} artist:${artist}`);
        const res = await fetch(`${API_BASE}/search?q=${q}&type=track&limit=1`, {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { tracks?: { items?: { uri: string }[] } };
        return data.tracks?.items?.[0]?.uri ?? null;
    } catch {
        return null;
    }
}

export interface ExportResult {
    playlistUrl: string;
    matched: number;
    total: number;
    misses: { title: string; artist: string }[];
}

/**
 * Creates a new playlist for the signed-in Spotify user and fills it in
 * ranked order. Songs that don't resolve to a Spotify track are skipped and
 * reported back by name -- see the results page's export panel, which shows
 * the honest "matched X of N" count plus the list of misses rather than
 * silently producing a shorter playlist.
 */
export async function exportRankedPlaylist(
    accessToken: string,
    playlistName: string,
    songs: { title: string; artist: string; spotifyUri: string | null }[]
): Promise<ExportResult | null> {
    const me = await spotifyMe(accessToken);
    if (!me) return null;

    try {
        const createRes = await fetch(`${API_BASE}/users/${encodeURIComponent(me.id)}/playlists`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                name: playlistName,
                description: "Ranked with SongRank",
                public: false,
            }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!createRes.ok) return null;
        const playlist = (await createRes.json()) as { id: string; external_urls: { spotify: string } };

        const uris: string[] = [];
        const misses: { title: string; artist: string }[] = [];
        for (const song of songs) {
            // A song imported straight from a Spotify playlist already carries
            // its URI -- no need to re-search for something we were just handed.
            if (song.spotifyUri) {
                uris.push(song.spotifyUri);
                continue;
            }
            const uri = await searchTrackUri(accessToken, song.title, song.artist);
            if (uri) uris.push(uri);
            else misses.push({ title: song.title, artist: song.artist });
        }

        // Spotify caps playlist-items additions at 100 URIs per request.
        for (let i = 0; i < uris.length; i += 100) {
            const batch = uris.slice(i, i + 100);
            await fetch(`${API_BASE}/playlists/${playlist.id}/tracks`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ uris: batch }),
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
        }

        return {
            playlistUrl: playlist.external_urls.spotify,
            matched: uris.length,
            total: songs.length,
            misses,
        };
    } catch {
        return null;
    }
}
