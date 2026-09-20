"use client";

import { useEffect, useState } from "react";

/**
 * Connect / disconnect Spotify, on the account page.
 *
 * Lives next to the username and delete-account controls for the same reason
 * they do: /my-rankings is the only page that exists *because* you have an
 * account, and a settings screen for three controls would be inventing
 * furniture.
 *
 * Renders nothing when the deployment has no Spotify credentials.
 */
export default function SpotifyConnection() {
    const [status, setStatus] = useState<{ configured: boolean; connected: boolean; spotifyUserId?: string | null } | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        fetch("/api/spotify/status")
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => setStatus(d ?? { configured: false, connected: false }))
            .catch(() => setStatus({ configured: false, connected: false }));
    }, []);

    async function disconnect() {
        setBusy(true);
        try {
            const res = await fetch("/api/spotify/disconnect", { method: "POST" });
            if (res.ok) setStatus((prev) => (prev ? { ...prev, connected: false, spotifyUserId: null } : prev));
        } finally {
            setBusy(false);
        }
    }

    if (!status?.configured) return null;

    return (
        <section className="mt-10 border-t border-border pt-6">
            <h2 className="mb-1 text-lg font-semibold">Spotify</h2>
            {status.connected ? (
                <>
                    <p className="mb-3 text-sm text-fg-muted">
                        Connected{status.spotifyUserId ? ` as ${status.spotifyUserId}` : ""}. Finished rankings can be
                        sent to Spotify as a playlist, in order.
                    </p>
                    <button type="button" onClick={disconnect} disabled={busy} className="btn-secondary !px-3 !py-1.5 text-xs">
                        {busy ? "…" : "Disconnect"}
                    </button>
                    {/* Said plainly because the obvious assumption is wrong:
                        Spotify has no API for revoking a grant, so this
                        destroys our copy of the tokens and nothing else. */}
                    <p className="mt-2 text-xs text-fg-muted">
                        Disconnecting deletes SongRank&apos;s access tokens. To remove the app from your Spotify
                        account entirely, use{" "}
                        <a
                            href="https://www.spotify.com/account/apps/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline underline-offset-2"
                        >
                            Spotify&apos;s apps page
                        </a>
                        .
                    </p>
                </>
            ) : (
                <>
                    <p className="mb-3 text-sm text-fg-muted">
                        Connect Spotify to turn a finished ranking into a playlist. SongRank asks only for permission
                        to create playlists — never to read your library or listening history.
                    </p>
                    <a href="/api/spotify/authorize" className="btn-secondary !px-3 !py-1.5 text-xs">
                        Connect Spotify
                    </a>
                </>
            )}
        </section>
    );
}
