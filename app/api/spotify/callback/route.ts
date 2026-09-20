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

    // Everything below is wrapped, and it was not originally -- which is how
    // the first real authorisation produced a bare HTTP 500 with nothing to go
    // on. This file is an API route and the house rule for those is guard ->
    // try/catch -> user-facing message (see CLAUDE.md); a route that ends a
    // redirect chain is not an exception to it, it is the case where an
    // unhandled throw is LEAST diagnosable, because the person is looking at a
    // browser error page rather than a fetch they can inspect.
    //
    // Each failure redirects with a distinct reason so the screen can say
    // something true, and logs with an UPPERCASE label so the server side of
    // it is greppable.
    try {
        return await handle(req, url, back);
    } catch (err) {
        console.error("SPOTIFY CALLBACK ERROR:", err);
        return back("failed");
    }
}

async function handle(
    req: Request,
    url: URL,
    back: (status: string) => NextResponse
): Promise<NextResponse> {
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
    if (!tokens) {
        console.error("SPOTIFY CALLBACK: token exchange returned nothing");
        return back("exchange_failed");
    }
    // A refresh token is required, not optional: without one this connection
    // dies in an hour and the person has to reauthorise, which they would
    // experience as the feature being broken rather than as a missing grant.
    if (!tokens.refreshToken) {
        console.error("SPOTIFY CALLBACK: no refresh token in the exchange response");
        return back("no_refresh_token");
    }

    const spotifyUserId = await currentUserId(tokens.accessToken);
    if (!spotifyUserId) {
        console.error("SPOTIFY CALLBACK: /v1/me did not return an id");
        return back("profile_failed");
    }

    try {
        await saveSpotifyAccount(g.userId, {
            spotifyUserId,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresAt: tokens.expiresAt,
        });
    } catch (err) {
        // Separated from the rest because the likely causes are specific and
        // actionable: the spotify_accounts table not existing yet (the
        // migration hasn't been run against this database), or AUTH_SECRET
        // being absent, which encryptToken refuses to work without.
        console.error("SPOTIFY CALLBACK: could not store the authorisation:", err);
        return back("save_failed");
    }

    const res = back("connected");
    // The state has done its job; leaving it set would let a later callback
    // replay it.
    res.cookies.set(STATE_COOKIE, "", { path: "/api/spotify", maxAge: 0 });
    return res;
}
