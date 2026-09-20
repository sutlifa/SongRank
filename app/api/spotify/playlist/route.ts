import { NextResponse } from "next/server";
import { requireUser, isGuardFailure } from "@/lib/auth-guard";
import { getTournament } from "@/lib/queries";
import { currentSpotifySession, isSessionFailure } from "@/lib/spotifySession";
import { addTracks, cleanUris, createPlaylist, playlistDescription } from "@/lib/spotify";
import { MAX_SONGS } from "@/lib/tournamentEngine";

/**
 * POST /api/spotify/playlist  { tournamentId, uris, public? }
 *
 * The ONE endpoint here that writes to somebody's Spotify account. Takes the
 * uris the person accepted on the review screen rather than re-matching, so
 * what gets created is exactly what they were shown -- re-matching here could
 * quietly produce a different answer between the screen and the write.
 */
export async function POST(req: Request) {
    const g = await requireUser();
    if (isGuardFailure(g)) return g.response;

    try {
        const body = (await req.json()) as { tournamentId?: unknown; uris?: unknown; public?: unknown };
        if (typeof body.tournamentId !== "string" || !body.tournamentId.trim()) {
            return NextResponse.json({ error: "Missing ranking id" }, { status: 400 });
        }
        if (!Array.isArray(body.uris)) {
            return NextResponse.json({ error: "Nothing to add" }, { status: 400 });
        }

        // The client chose these, so they are validated here rather than
        // trusted: this endpoint is reachable directly, and a crafted value
        // has no business in a write made on someone's behalf.
        const uris = cleanUris(body.uris);
        if (uris.length === 0) return NextResponse.json({ error: "Nothing to add" }, { status: 400 });
        if (uris.length > MAX_SONGS) {
            return NextResponse.json({ error: "That's more songs than a ranking can hold" }, { status: 413 });
        }

        const tournament = await getTournament(g.userId, body.tournamentId);
        if (!tournament) return NextResponse.json({ error: "Ranking not found" }, { status: 404 });

        const session = await currentSpotifySession(g.userId);
        if (isSessionFailure(session)) {
            return NextResponse.json(
                {
                    error:
                        session.failure === "not_connected"
                            ? "Connect Spotify first."
                            : "Your Spotify connection expired — connect again.",
                    reason: session.failure,
                },
                { status: 409 }
            );
        }

        const playlist = await createPlaylist(
            session.accessToken,
            session.spotifyUserId,
            tournament.name,
            playlistDescription(tournament.name, tournament.songs.length, tournament.votes.length),
            body.public === true
        );
        if (!playlist) {
            return NextResponse.json({ error: "Spotify wouldn't create the playlist" }, { status: 502 });
        }

        const { added, complete } = await addTracks(session.accessToken, playlist.id, uris);
        // A partial result is reported as one. The playlist EXISTS at this
        // point, so calling it a failure would send someone looking for
        // something they already have.
        return NextResponse.json({
            url: playlist.url,
            added,
            requested: uris.length,
            complete,
        });
    } catch (err) {
        console.error("SPOTIFY PLAYLIST ERROR:", err);
        return NextResponse.json({ error: "Could not create the playlist" }, { status: 500 });
    }
}
