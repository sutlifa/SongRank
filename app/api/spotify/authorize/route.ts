import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requireUser, isGuardFailure } from "@/lib/auth-guard";
import { authorizeUrl, hasSpotifyCredentials } from "@/lib/spotifyAuth";

/** The state cookie's name and lifetime. Short: it only has to survive one
 * round trip to Spotify and back. */
const STATE_COOKIE = "songrank_spotify_state";
const STATE_MAX_AGE = 600;

/**
 * GET /api/spotify/authorize
 *
 * Sends a signed-in person to Spotify to authorise playlist writes.
 *
 * Guarded before anything else: the callback attaches the resulting tokens to
 * a SongRank user id, so there has to be one. Starting the flow signed out
 * would mean arriving back with a valid Spotify authorisation and nowhere to
 * put it.
 */
export async function GET(req: Request) {
    if (!hasSpotifyCredentials()) {
        return NextResponse.json({ error: "Spotify export isn't configured on this deployment." }, { status: 503 });
    }
    const g = await requireUser();
    if (isGuardFailure(g)) return g.response;

    // The CSRF defence. Without it somebody can hand a victim a crafted
    // callback link and attach THEIR Spotify account to the victim's SongRank
    // account, after which every playlist the victim exports is written
    // somewhere they cannot see.
    const state = randomBytes(32).toString("base64url");
    const res = NextResponse.redirect(authorizeUrl(new URL(req.url).origin, state));
    res.cookies.set(STATE_COOKIE, state, {
        httpOnly: true,
        sameSite: "lax", // must survive the top-level redirect back from Spotify
        secure: new URL(req.url).protocol === "https:",
        path: "/api/spotify",
        maxAge: STATE_MAX_AGE,
    });
    return res;
}
