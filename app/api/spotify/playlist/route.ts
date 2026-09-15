import { NextResponse } from "next/server";
import { getPlaylistTracks, parsePlaylistId, isSpotifyConfigured } from "@/lib/spotify";
import { MAX_SONGS } from "@/lib/swiss";

/**
 * GET /api/spotify/playlist?url=...
 *
 * Reads a *public* Spotify playlist's track list via the client-credentials
 * flow (see lib/spotify.ts's header) -- no Spotify sign-in required. No auth
 * guard here either: importing a playlist works fully signed out, same as
 * paste and search.
 */
export async function GET(req: Request) {
    if (!isSpotifyConfigured()) {
        return NextResponse.json(
            { error: "Spotify import isn't configured on this deployment. Try paste or search instead." },
            { status: 503 }
        );
    }

    const input = new URL(req.url).searchParams.get("url") ?? "";
    const playlistId = parsePlaylistId(input);
    if (!playlistId) {
        return NextResponse.json(
            { error: "That doesn't look like a Spotify playlist link" },
            { status: 400 }
        );
    }

    try {
        const tracks = await getPlaylistTracks(playlistId);
        if (!tracks) {
            return NextResponse.json(
                { error: "Could not read that playlist. Make sure it's public and the link is correct." },
                { status: 502 }
            );
        }
        if (tracks.length === 0) {
            return NextResponse.json({ error: "That playlist has no tracks" }, { status: 400 });
        }

        const truncated = tracks.length > MAX_SONGS;
        return NextResponse.json({ songs: tracks.slice(0, MAX_SONGS), truncated });
    } catch (err) {
        console.error("SPOTIFY PLAYLIST IMPORT ERROR:", err);
        return NextResponse.json({ error: "Could not import that playlist" }, { status: 500 });
    }
}
