import { NextResponse } from "next/server";
import { requireUser, isGuardFailure } from "@/lib/auth-guard";
import { deleteSpotifyAccount } from "@/lib/queries";

/**
 * POST /api/spotify/disconnect
 *
 * Forgets this person's Spotify authorisation.
 *
 * Deleting the row is the whole operation -- Spotify is a capability here, not
 * an identity, so there is no session to unwind and nothing else references
 * it. It does NOT revoke the grant on Spotify's side (their API has no
 * endpoint for that); the tokens are simply destroyed, so this app can no
 * longer act on it. The UI says so rather than implying more than happened,
 * and points at Spotify's own app-permissions page for a full revoke.
 */
export async function POST() {
    const g = await requireUser();
    if (isGuardFailure(g)) return g.response;
    try {
        await deleteSpotifyAccount(g.userId);
        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error("SPOTIFY DISCONNECT ERROR:", err);
        return NextResponse.json({ error: "Could not disconnect Spotify" }, { status: 500 });
    }
}
