import { NextResponse } from "next/server";
import { requireUser, isGuardFailure } from "@/lib/auth-guard";
import { getTournament } from "@/lib/queries";
import { currentSpotifySession, isSessionFailure } from "@/lib/spotifySession";
import { apiSearch, matchTracks, versionMismatch, SpotifyUnavailableError } from "@/lib/spotify";
import { deriveTournament } from "@/lib/tournamentEngine";

/**
 * POST /api/spotify/match  { tournamentId }
 *
 * Works out what each song in a finished ranking would become on Spotify.
 * WRITES NOTHING -- this is the review step, and the whole point of splitting
 * it from the create step is that a person sees every match before anything
 * lands in their account.
 *
 * The old Spotify *import* was removed because a plausible-looking wrong
 * recording arrives silently and nothing ever tells its owner. This endpoint
 * exists so the equivalent cannot happen on the way out.
 */
export async function POST(req: Request) {
    const g = await requireUser();
    if (isGuardFailure(g)) return g.response;

    try {
        const body = (await req.json()) as { tournamentId?: unknown };
        if (typeof body.tournamentId !== "string" || !body.tournamentId.trim()) {
            return NextResponse.json({ error: "Missing ranking id" }, { status: 400 });
        }

        // Scoped to this user's own rankings. Matching someone else's is a
        // read of their song list they never agreed to, and there is no
        // reason to export a ranking you do not own.
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

        // Export follows the RANKING's order, so the songs are taken from the
        // derived standings rather than the seeded list.
        //
        // `getTournament` returns the database ROW (snake_case, no timestamps
        // in the engine's shape), so it is adapted here the same way
        // getTopCuts does. The fields left blank genuinely have no effect on
        // standings -- the engines read songs, votes, format and depth and
        // nothing else.
        const derived = deriveTournament({
            id: tournament.id,
            name: tournament.name,
            createdAt: "",
            updatedAt: "",
            clipSeconds: tournament.clip_seconds,
            format: tournament.format,
            depth: tournament.depth ?? undefined,
            songs: tournament.songs,
            votes: tournament.votes,
        });
        const byId = new Map(tournament.songs.map((s) => [s.id, s]));
        const ordered = derived.standings.flatMap((standing) => {
            const song = byId.get(standing.songId);
            return song ? [{ title: song.title, artist: song.artist }] : [];
        });

        const matches = await matchTracks(ordered, apiSearch(session.accessToken));
        return NextResponse.json({
            name: tournament.name,
            songCount: tournament.songs.length,
            matchupCount: tournament.votes.length,
            matches: matches.map((m) => ({
                ...m,
                // Same title, same credited artist, different recording --
                // scores "high" on every text measure, so it is flagged
                // separately rather than left to be noticed by eye.
                versionWarning: m.match ? versionMismatch({ title: m.title }, { title: m.match.title }) : false,
            })),
        });
    } catch (err) {
        if (err instanceof SpotifyUnavailableError) {
            // Distinct from "no match": reporting a rate limit as "not on
            // Spotify" is the exact lie lib/itunes.ts documents at length.
            return NextResponse.json({ error: "Spotify didn't answer — try again in a moment." }, { status: 503 });
        }
        console.error("SPOTIFY MATCH ERROR:", err);
        return NextResponse.json({ error: "Could not check your songs against Spotify" }, { status: 500 });
    }
}
