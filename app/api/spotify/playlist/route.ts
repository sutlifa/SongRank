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

    // Spotify's own editorial and algorithmic playlists ("Today's Top Hits",
    // the Disney/mood/decade mixes, Discover Weekly) all carry ids beginning
    // `37i9dQZ`, and since late 2024 the Web API returns 404 for them to
    // third-party applications however the caller authenticates. They are
    // still fully public inside Spotify's own apps, which is exactly why this
    // needs saying out loud: the generic "make sure it's public" message sends
    // someone off to re-check a setting that is already correct and cannot be
    // the cause. Detected up front rather than inferred from the 404, so the
    // advice is specific instead of a guess about why the read failed.
    if (playlistId.startsWith("37i9dQZ")) {
        return NextResponse.json(
            {
                error:
                    "That's a Spotify-curated playlist, and Spotify's API blocks other apps from reading those — it isn't your link or its privacy setting. Open it in Spotify, add the tracks to a playlist of your own, and import that instead. Pasting the song list also works.",
            },
            { status: 400 }
        );
    }

    try {
        const tracks = await getPlaylistTracks(playlistId);
        if (!tracks) {
            return NextResponse.json(
                {
                    error:
                        "Could not read that playlist. It has to be one created by a Spotify user and set to public — Spotify's own curated playlists can't be read by other apps.",
                },
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
