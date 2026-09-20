import { NextResponse } from "next/server";
import { requireUser, isGuardFailure } from "@/lib/auth-guard";
import { getTournament, getCachedSpotifyMatches, saveCachedSpotifyMatches, type CachedSpotifyMatch } from "@/lib/queries";
import { currentSpotifySession, isSessionFailure } from "@/lib/spotifySession";
import { apiSearch, matchTracks, versionMismatch, SpotifyUnavailableError, MATCH_SLICE, cacheKey, type TrackMatch } from "@/lib/spotify";
import { deriveTournament } from "@/lib/tournamentEngine";

/**
 * Vercel kills a function at its duration limit, and the default is short. A
 * slice of MATCH_SLICE songs at MATCH_CONCURRENCY at a time is a few seconds;
 * this is headroom for a slow upstream, not a target.
 */
export const maxDuration = 60;

/**
 * POST /api/spotify/match  { tournamentId, offset?, limit? }
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
        const body = (await req.json()) as { tournamentId?: unknown; offset?: unknown };
        if (typeof body.tournamentId !== "string" || !body.tournamentId.trim()) {
            return NextResponse.json({ error: "Missing ranking id" }, { status: 400 });
        }
        const offset = Number.isInteger(body.offset) && (body.offset as number) >= 0 ? (body.offset as number) : 0;

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

        // A SLICE, not the whole ranking.
        //
        // Matching every song in one request is what made this fail on a real
        // ranking: even a few hundred milliseconds per lookup adds up past the
        // function's duration limit, and the killed request surfaced as
        // "Spotify didn't answer" -- an aborted fetch and a quiet upstream are
        // indistinguishable from inside. The client walks the ranking a slice
        // at a time and can show progress while it does.
        const slice = ordered.slice(offset, offset + MATCH_SLICE);

        // Remembered answers first. Against a development-mode quota a search
        // result is the scarcest thing this feature has -- exhaust the
        // allowance and the app is locked out for a while -- so a song that
        // has ever been looked up, by anyone, is never looked up again. A
        // re-run or a resumed export therefore costs nothing for the part
        // already done.
        //
        // The cache is an ACCELERATOR, never a dependency. A table that has
        // not been migrated yet, or a database hiccup, must cost speed and
        // nothing else -- an export that dies because its optimisation is
        // unavailable is strictly worse than one that never had it. So both
        // halves are guarded and both log loudly: a cache silently doing
        // nothing looks exactly like a rate limit that never lifts.
        const keys = slice.map((song) => cacheKey(song.title, song.artist));
        let cached: Awaited<ReturnType<typeof getCachedSpotifyMatches>>;
        try {
            cached = await getCachedSpotifyMatches(keys);
        } catch (err) {
            console.error("SPOTIFY MATCH CACHE READ FAILED:", err);
            cached = new Map();
        }
        const keyOf = (i: number) => `${keys[i].titleKey}\u0000${keys[i].artistKey}`;

        const unknown: { song: { title: string; artist: string }; index: number }[] = [];
        const matches: TrackMatch[] = slice.map((song, i) => {
            const hit = cached.get(keyOf(i));
            if (!hit) {
                unknown.push({ song, index: i });
                // Placeholder; replaced below once the search answers.
                return { rank: offset + i + 1, title: song.title, artist: song.artist, match: null, confidence: "none" };
            }
            return {
                rank: offset + i + 1,
                title: song.title,
                artist: song.artist,
                match: hit.uri
                    ? {
                          id: hit.uri.split(":").pop() ?? hit.uri,
                          uri: hit.uri,
                          title: hit.title ?? song.title,
                          artist: hit.artist ?? song.artist,
                          album: hit.album,
                          durationMs: null,
                          explicit: false,
                      }
                    : null,
                confidence: hit.confidence,
            };
        });

        // Only genuine unknowns reach Spotify.
        if (unknown.length > 0) {
            // Banked as each answer lands, not after the batch finishes.
            //
            // This is the difference between a lockout costing a slice and a
            // lockout costing nothing. A 429 part-way through rejects
            // matchTracks, and the old shape -- await, then remember -- threw
            // away every answer already paid for along with it. So a person
            // who came back after the penalty re-paid for the same songs, hit
            // the limit at the same place, and never advanced. Now the
            // callback records each one as it arrives and the save runs even
            // on the way out, so every request spent is a song learned for
            // good and the next attempt starts further along.
            const toRemember: CachedSpotifyMatch[] = [];
            try {
                await matchTracks(
                    unknown.map((u) => u.song),
                    apiSearch(session.accessToken),
                    {
                        onResult: (n, result) => {
                            const { index } = unknown[n];
                            matches[index] = { ...result, rank: offset + index + 1 };
                            toRemember.push({
                                titleKey: keys[index].titleKey,
                                artistKey: keys[index].artistKey,
                                uri: result.match?.uri ?? null,
                                title: result.match?.title ?? null,
                                artist: result.match?.artist ?? null,
                                album: result.match?.album ?? null,
                                // A miss is remembered too: it cost a request
                                // to learn, and re-learning it costs another.
                                confidence: result.confidence,
                            });
                        },
                    }
                );
            } finally {
                // Deliberately in `finally`: the case worth saving for is the
                // one where the line above threw. And deliberately swallowed:
                // failing to REMEMBER an answer must not destroy the answer,
                // least of all on the rate-limited path, where the whole
                // point is to hand back whatever was bought.
                if (toRemember.length > 0) {
                    try {
                        await saveCachedSpotifyMatches(toRemember);
                    } catch (err) {
                        console.error("SPOTIFY MATCH CACHE WRITE FAILED:", err);
                    }
                }
            }
        }
        return NextResponse.json({
            name: tournament.name,
            songCount: tournament.songs.length,
            matchupCount: tournament.votes.length,
            total: ordered.length,
            offset,
            // So the UI can say how much of this cost nothing.
            fromCache: slice.length - unknown.length,
            done: offset + slice.length >= ordered.length,
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
            //
            // `reason` rides along -- it is an HTTP status or a network error
            // string, never a token or a secret -- because the friendly
            // sentence alone left the first real failure undiagnosable without
            // reading a server log.
            console.error("SPOTIFY MATCH UNAVAILABLE:", err.reason, "retryAfter:", err.retryAfterSeconds);
            const limited = err.reason === "HTTP 429";
            return NextResponse.json(
                {
                    error: limited
                        ? "Spotify is rate-limiting this app — waiting before trying again."
                        : "Spotify didn't answer — try again in a moment.",
                    reason: err.reason,
                    // How long Spotify asked us to wait. The client sits it
                    // out and resumes the SAME slice, so the wait happens in a
                    // browser rather than inside the function's duration
                    // budget, and no matched songs are thrown away.
                    retryAfter: err.retryAfterSeconds,
                },
                { status: 503 }
            );
        }
        // `reason` rides along for the same reason it does on the 503 above:
        // the friendly sentence alone left the first real failure of this
        // route undiagnosable without someone reading a server log, and the
        // person who hits it is the one who can say what it said. It is an
        // error message, never a token, a secret or a stack trace.
        console.error("SPOTIFY MATCH ERROR:", err);
        return NextResponse.json(
            {
                error: "Could not check your songs against Spotify",
                // Capped: a driver can attach a very long detail string,
                // and this ends up rendered in a sentence on screen.
                reason: (err instanceof Error ? err.message : String(err)).slice(0, 200),
            },
            { status: 500 }
        );
    }
}
