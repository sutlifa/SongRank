import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
    exchangeCodeForToken,
    SPOTIFY_STATE_COOKIE,
    SPOTIFY_RETURN_TO_COOKIE,
    SPOTIFY_TOKEN_COOKIE,
} from "@/lib/spotify";

/**
 * GET /api/spotify/callback?code=...&state=...
 *
 * The redirect target registered in the Spotify dashboard (must match
 * SPOTIFY_REDIRECT_URI exactly). Verifies the CSRF state cookie set by
 * /api/spotify/connect, exchanges the auth code for an access token, stashes
 * that token in its own short-lived httpOnly cookie, and sends the browser
 * back to wherever it started (the tournament results page).
 *
 * Every failure path still redirects back to `returnTo` -- with a
 * `spotifyError` query param instead of a token cookie -- rather than
 * showing a bare error page, so the export panel can explain what happened
 * in place instead of stranding the user off the app.
 */
export async function GET(req: Request) {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const deniedReason = url.searchParams.get("error"); // e.g. "access_denied" if they hit Cancel

    // cookies() is async in Next 16 (same as params/searchParams) -- see
    // AGENTS.md.
    const store = await cookies();
    const returnTo = store.get(SPOTIFY_RETURN_TO_COOKIE)?.value;
    const savedState = store.get(SPOTIFY_STATE_COOKIE)?.value;

    const dest = new URL(returnTo || "/", url.origin);
    const fail = (message: string) => {
        dest.searchParams.set("spotifyError", message);
        const res = NextResponse.redirect(dest);
        res.cookies.delete(SPOTIFY_STATE_COOKIE);
        res.cookies.delete(SPOTIFY_RETURN_TO_COOKIE);
        return res;
    };

    if (deniedReason) return fail("Spotify sign-in was cancelled");
    if (!code || !state) return fail("Spotify didn't return an authorization code");
    if (!savedState || savedState !== state) return fail("Spotify sign-in expired or was tampered with");

    const redirectUri = process.env.SPOTIFY_REDIRECT_URI;
    if (!redirectUri) return fail("Spotify export isn't configured on this deployment");

    try {
        const token = await exchangeCodeForToken(code, redirectUri);
        if (!token) return fail("Could not complete Spotify sign-in");

        // Tells ExportPanel to pick the export back up where the click left
        // off, instead of leaving the user connected but with nothing having
        // actually happened.
        dest.searchParams.set("spotifyConnected", "1");
        const res = NextResponse.redirect(dest);
        res.cookies.delete(SPOTIFY_STATE_COOKIE);
        res.cookies.delete(SPOTIFY_RETURN_TO_COOKIE);
        res.cookies.set(SPOTIFY_TOKEN_COOKIE, JSON.stringify(token), {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            path: "/",
            maxAge: Math.max(60, token.expiresAt - Math.floor(Date.now() / 1000)),
        });
        return res;
    } catch (err) {
        console.error("SPOTIFY CALLBACK ERROR:", err);
        return fail("Could not complete Spotify sign-in");
    }
}
