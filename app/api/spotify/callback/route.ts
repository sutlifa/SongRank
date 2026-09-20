import { NextResponse } from "next/server";
import { requireUser, isGuardFailure } from "@/lib/auth-guard";
import { currentUserId, exchangeCode, hasSpotifyCredentials, statesMatch } from "@/lib/spotifyAuth";
import { saveSpotifyAccount } from "@/lib/queries";

const STATE_COOKIE = "songrank_spotify_state";
/** Where the person lands afterwards, with a flag the page reads once. */
const DONE = "/my-rankings?spotify=";

/**
 * GET /api/spotify/callback
 *
 * Where Spotify sends the browser back. Redirects rather than rendering: this
 * is the end of an OAuth round trip, and the person should finish on a page
 * they recognise, not on a JSON blob.
 *
 * Every failure path lands on the same page with a reason in the query string.
 * None of them says anything about the client secret or the token endpoint's
 * response -- those go to the server log (see lib/spotifyAuth.ts) because the
 * person reading this can only act on "it didn't work, try again".
 */
export async function GET(req: Request) {
    const url = new URL(req.url);
    const back = (status: string) => NextResponse.redirect(new URL(`${DONE}${status}`, url.origin));

    if (!hasSpotifyCredentials()) return back("unconfigured");

    const g = await requireUser();
    if (isGuardFailure(g)) return back("signedout");

    // Spotify's own refusal -- most often the person pressing Cancel on the
    // authorisation screen, which is not an error and should not look like one.
    const denied = url.searchParams.get("error");
    if (denied) return back(denied === "access_denied" ? "cancelled" : "failed");

    const issued = req.headers
        .get("cookie")
        ?.split(";")
        .map((c) => c.trim())
        .find((c) => c.startsWith(`${STATE_COOKIE}=`))
        ?.slice(STATE_COOKIE.length + 1);
    if (!statesMatch(issued, url.searchParams.get("state") ?? undefined)) return back("badstate");

    const code = url.searchParams.get("code");
    if (!code) return back("failed");

    const tokens = await exchangeCode(code, url.origin);
    // A refresh token is required, not optional: without one this connection
    // dies in an hour and the person has to reauthorise, which they would
    // experience as the feature being broken rather than as a missing grant.
    if (!tokens?.refreshToken) return back("failed");

    const spotifyUserId = await currentUserId(tokens.accessToken);
    if (!spotifyUserId) return back("failed");

    await saveSpotifyAccount(g.userId, {
        spotifyUserId,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
    });

    const res = back("connected");
    // The state has done its job; leaving it set would let a later callback
    // replay it.
    res.cookies.set(STATE_COOKIE, "", { path: "/api/spotify", maxAge: 0 });
    return res;
}
