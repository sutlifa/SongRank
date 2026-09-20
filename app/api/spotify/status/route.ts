import { NextResponse } from "next/server";
import { requireUser, isGuardFailure } from "@/lib/auth-guard";
import { getSpotifyAccount } from "@/lib/queries";
import { hasSpotifyCredentials } from "@/lib/spotifyAuth";

/**
 * GET /api/spotify/status
 *
 * Whether this person has a usable Spotify authorisation, so the UI can show
 * "Connect" or "Send to Spotify" without guessing.
 *
 * Deliberately returns no token and no ids -- only a boolean and the account
 * name. A status endpoint that hands out credentials is a status endpoint that
 * becomes a credential endpoint the first time someone calls it directly.
 */
export async function GET() {
    if (!hasSpotifyCredentials()) return NextResponse.json({ configured: false, connected: false });
    const g = await requireUser();
    if (isGuardFailure(g)) return NextResponse.json({ configured: true, connected: false });
    try {
        const account = await getSpotifyAccount(g.userId);
        return NextResponse.json({
            configured: true,
            connected: Boolean(account),
            spotifyUserId: account?.spotifyUserId ?? null,
        });
    } catch (err) {
        console.error("SPOTIFY STATUS ERROR:", err);
        return NextResponse.json({ configured: true, connected: false });
    }
}
