// lib/spotifySession.ts
//
// One job: hand a caller an access token that will still be valid for the next
// request, refreshing it first if it won't be.
//
// Its own module rather than a function in lib/queries.ts because it is the
// one place that spans both halves -- it reads the database, talks to
// accounts.spotify.com, and writes back. Putting it in queries.ts would give
// that module a network dependency it has never had; putting it in
// spotifyAuth.ts would give that one a database dependency it has never had.

import { getSpotifyAccount, updateSpotifyAccessToken } from "./queries";
import { isExpired, refreshAccessToken } from "./spotifyAuth";

export interface SpotifySession {
    accessToken: string;
    spotifyUserId: string;
}

/**
 * The reason a session could not be produced, for a caller that has to say
 * something useful to a person.
 *
 * "not connected" and "reconnect" are genuinely different and must not be
 * collapsed: the first means they never authorised us, the second means they
 * did and it stopped working (a revoked grant, a rotated AUTH_SECRET). Telling
 * someone who has connected Spotify that they have not is how you get a bug
 * report saying the button does nothing.
 */
export type SpotifySessionFailure = "not_connected" | "reconnect";

export async function currentSpotifySession(
    userId: number
): Promise<SpotifySession | { failure: SpotifySessionFailure }> {
    const account = await getSpotifyAccount(userId);
    // getSpotifyAccount also returns null for a row it could not DECRYPT,
    // which is what a rotated AUTH_SECRET looks like. Both mean the same thing
    // to this caller -- there is no usable authorisation -- and both are
    // resolved the same way, by connecting again.
    if (!account) return { failure: "not_connected" };

    if (!isExpired(account.expiresAt)) {
        return { accessToken: account.accessToken, spotifyUserId: account.spotifyUserId };
    }

    // Expired, or close enough to it that a long export would outlive it --
    // see EXPIRY_MARGIN_MS.
    const refreshed = await refreshAccessToken(account.refreshToken);
    if (!refreshed) return { failure: "reconnect" };

    // Spotify returns a new refresh token only sometimes; the old one stays
    // valid when it doesn't, so it is passed through rather than overwritten.
    await updateSpotifyAccessToken(userId, refreshed.accessToken, refreshed.expiresAt, refreshed.refreshToken);
    return { accessToken: refreshed.accessToken, spotifyUserId: account.spotifyUserId };
}

export function isSessionFailure(
    value: SpotifySession | { failure: SpotifySessionFailure }
): value is { failure: SpotifySessionFailure } {
    return "failure" in value;
}
