"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * The one-line result of a Spotify authorisation round trip.
 *
 * Exists because the callback can only communicate by redirecting, and a
 * redirect that lands on an unchanged page is indistinguishable from nothing
 * happening. Worse, the first real authorisation attempt produced an HTTP 500
 * -- a browser error page, with the reason only in a server log nobody was
 * looking at. Each failure now arrives as a distinct reason, and each reason
 * says what to do about it rather than "something went wrong".
 */
const MESSAGES: Record<string, { tone: "good" | "bad"; text: string }> = {
    connected: { tone: "good", text: "Spotify connected. Finished rankings can now be sent over as a playlist." },
    cancelled: { tone: "bad", text: "Spotify authorisation was cancelled — nothing was connected." },
    unconfigured: { tone: "bad", text: "Spotify isn't configured on this deployment." },
    signedout: { tone: "bad", text: "You were signed out partway through. Sign in and try connecting again." },
    badstate: {
        tone: "bad",
        // Deliberately not alarming: the overwhelmingly common cause is a
        // stale tab or a link opened twice, not an attack. It is still
        // refused either way.
        text: "That Spotify link didn't match this browser session — start the connection again from this page.",
    },
    exchange_failed: {
        tone: "bad",
        text: "Spotify wouldn't complete the connection. Check that the redirect URI registered on the Spotify app exactly matches this site's /api/spotify/callback.",
    },
    no_refresh_token: {
        tone: "bad",
        text: "Spotify connected but didn't return a refresh token, so the connection wouldn't survive the hour. Nothing was saved.",
    },
    profile_failed: { tone: "bad", text: "Spotify wouldn't tell us which account authorised. Try connecting again." },
    save_failed: {
        tone: "bad",
        text: "Couldn't store the connection. If this deployment's database is missing the spotify_accounts table, re-run lib/db/schema.sql.",
    },
    failed: { tone: "bad", text: "Connecting to Spotify didn't work. Try again." },
};

export default function SpotifyCallbackNotice() {
    const params = useSearchParams();
    const router = useRouter();
    const status = params.get("spotify");
    const [dismissed, setDismissed] = useState(false);

    // Strip the flag once it has been read, so a refresh doesn't replay a
    // stale "connected" or a stale error.
    useEffect(() => {
        if (!status) return;
        const timer = setTimeout(() => router.replace("/my-rankings"), 100);
        return () => clearTimeout(timer);
    }, [status, router]);

    if (!status || dismissed) return null;
    const message = MESSAGES[status] ?? MESSAGES.failed;

    return (
        <div
            role="status"
            className={`mb-4 flex items-start gap-3 rounded-lg border px-3 py-2 text-sm ${
                message.tone === "good"
                    ? "border-accent/30 bg-accent/10 text-fg"
                    : "border-danger/30 bg-danger/10 text-fg"
            }`}
        >
            <span className="flex-1">{message.text}</span>
            <button
                type="button"
                onClick={() => setDismissed(true)}
                className="shrink-0 text-fg-muted hover:text-fg"
                aria-label="Dismiss"
            >
                ✕
            </button>
        </div>
    );
}
