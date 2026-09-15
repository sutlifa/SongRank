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
        const result = await getPlaylistTracks(playlistId);
        if (!result.ok) {
            // Each cause gets its own sentence. These all used to be one
            // message telling the user to check that the playlist is public,
            // which wastes their time when the playlist is public and the
            // actual fault is our credentials or Spotify itself.
            const message =
                result.reason === "no-token"
                    ? "Spotify rejected this app's credentials, so nothing can be imported right now. This is a problem with the deployment's Spotify configuration, not with your playlist."
                    : result.reason === "not-found"
                      ? "Spotify says that playlist doesn't exist or isn't visible to other apps. If it's yours, open it in Spotify and check it's set to public — a playlist made in the mobile app is private by default."
                      : result.reason === "forbidden"
                        ? "Spotify refused access to that playlist. If it's yours and set to public, the app's Spotify credentials may not have permission to read it."
                        : result.reason === "rate-limited"
                          ? "Spotify is rate-limiting requests right now. Wait a minute and try again."
                          : "Spotify couldn't be reached just now. Try again in a moment, or paste the song list instead.";
            return NextResponse.json({ error: message }, { status: 502 });
        }
        const tracks = result.tracks;
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
