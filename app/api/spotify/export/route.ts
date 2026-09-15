import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exportRankedPlaylist, isSpotifyExportConfigured, SPOTIFY_TOKEN_COOKIE, type SpotifyUserToken } from "@/lib/spotify";

/**
 * POST /api/spotify/export  { name, songs: [{ title, artist, spotifyUri }] }
 *
 * Creates a playlist in the signed-in Spotify user's account and fills it in
 * ranked order. "Signed in" here means holding a valid token in the httpOnly
 * cookie /api/spotify/callback set -- there's no app-level user session
 * requirement (unlike /api/tournaments), since export doesn't need an
 * account with SongRank at all, only with Spotify.
 */
export async function POST(req: Request) {
    if (!isSpotifyExportConfigured()) {
        return NextResponse.json(
            { error: "Spotify export isn't configured on this deployment." },
            { status: 503 }
        );
    }

    const store = await cookies();
    const raw = store.get(SPOTIFY_TOKEN_COOKIE)?.value;
    if (!raw) {
        return NextResponse.json(
            { error: "Not connected to Spotify. Click \"Export to Spotify\" to sign in." },
            { status: 401 }
        );
    }

    let token: SpotifyUserToken;
    try {
        token = JSON.parse(raw);
    } catch {
        return NextResponse.json({ error: "Your Spotify session is invalid. Please reconnect." }, { status: 401 });
    }
    if (!token.accessToken || token.expiresAt < Math.floor(Date.now() / 1000)) {
        return NextResponse.json(
            { error: "Your Spotify session expired. Click \"Export to Spotify\" to reconnect." },
            { status: 401 }
        );
    }

    try {
        const body = await req.json();
        const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : "SongRank export";
        const songs = Array.isArray(body?.songs) ? body.songs : [];
        if (songs.length === 0) {
            return NextResponse.json({ error: "Nothing to export" }, { status: 400 });
        }
        if (songs.length > 500) {
            return NextResponse.json({ error: "That ranking is too large to export" }, { status: 413 });
        }

        const result = await exportRankedPlaylist(token.accessToken, name, songs);
        if (!result) {
            return NextResponse.json({ error: "Could not create the Spotify playlist" }, { status: 502 });
        }

        return NextResponse.json({ result });
    } catch (err) {
        console.error("SPOTIFY EXPORT ERROR:", err);
        return NextResponse.json({ error: "Could not export to Spotify" }, { status: 500 });
    }
}
