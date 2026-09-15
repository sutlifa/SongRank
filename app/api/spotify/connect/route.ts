import { NextResponse } from "next/server";
import { buildAuthorizeUrl, isSpotifyExportConfigured, SPOTIFY_STATE_COOKIE, SPOTIFY_RETURN_TO_COOKIE } from "@/lib/spotify";

/**
 * GET /api/spotify/connect?returnTo=/t/<id>/results
 *
 * Starts the OAuth authorization-code flow for the ranked-playlist export.
 * Redirects the browser to Spotify's consent screen; /api/spotify/callback
 * handles the return trip.
 *
 * The `state` cookie is the CSRF defense standard to this flow (Spotify
 * echoes it back verbatim, and the callback refuses to proceed unless it
 * matches). `returnTo` rides along in its own cookie rather than as a bare
 * query param on the redirect_uri, because redirect_uri has to match the
 * Spotify dashboard's registration *exactly* -- appending a dynamic query
 * string to it would break that match.
 */
export async function GET(req: Request) {
    const url = new URL(req.url);
    const requested = url.searchParams.get("returnTo") ?? "/";

    // Same rule as the sign-in page's callbackUrl: a single leading slash
    // isn't enough ("//evil.com" also starts with "/" and browsers read it as
    // protocol-relative), so a second character that isn't a slash is required.
    const returnTo =
        requested.startsWith("/") && !requested.startsWith("//") && !requested.startsWith("/\\")
            ? requested
            : "/";

    if (!isSpotifyExportConfigured()) {
        const dest = new URL(returnTo, url.origin);
        dest.searchParams.set("spotifyError", "Spotify export isn't configured on this deployment.");
        return NextResponse.redirect(dest);
    }

    const redirectUri = process.env.SPOTIFY_REDIRECT_URI!;
    const state = crypto.randomUUID();
    const authorizeUrl = buildAuthorizeUrl(state, redirectUri);
    if (!authorizeUrl) {
        const dest = new URL(returnTo, url.origin);
        dest.searchParams.set("spotifyError", "Spotify export isn't configured on this deployment.");
        return NextResponse.redirect(dest);
    }

    const res = NextResponse.redirect(authorizeUrl);
    const cookieOpts = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax" as const,
        path: "/",
        maxAge: 600, // 10 minutes -- long enough to complete a consent screen, no longer
    };
    res.cookies.set(SPOTIFY_STATE_COOKIE, state, cookieOpts);
    res.cookies.set(SPOTIFY_RETURN_TO_COOKIE, returnTo, cookieOpts);
    return res;
}
