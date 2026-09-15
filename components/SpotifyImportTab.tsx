"use client";

import { useState } from "react";
import type { DraftSong } from "./NewTournament";

/**
 * The Spotify playlist tab. Only needs SPOTIFY_CLIENT_ID/SECRET (the
 * client-credentials flow reads a public playlist with no user sign-in) --
 * see /api/spotify/playlist and lib/spotify.ts. Imported songs still need a
 * preview resolved from iTunes before the tournament starts, same as a
 * pasted song, since Spotify's API can't supply one (see lib/itunes.ts).
 */
export default function SpotifyImportTab({
    enabled,
    onAdd,
}: {
    enabled: boolean;
    onAdd: (songs: DraftSong[]) => void;
}) {
    const [url, setUrl] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [summary, setSummary] = useState<{ added: number; truncated: boolean } | null>(null);

    async function handleImport() {
        if (!url.trim()) return;
        setLoading(true);
        setError(null);
        setSummary(null);
        try {
            const res = await fetch(`/api/spotify/playlist?url=${encodeURIComponent(url.trim())}`);
            const data = await res.json();
            if (!res.ok) {
                setError(data.error ?? "Could not import that playlist");
                return;
            }
            const drafts: DraftSong[] = (data.songs as { title: string; artist: string; spotifyUri: string }[]).map(
                (s) => ({
                    id: crypto.randomUUID(),
                    title: s.title,
                    artist: s.artist,
                    ambiguous: false,
                    resolved: null,
                    spotifyUri: s.spotifyUri,
                })
            );
            onAdd(drafts);
            setSummary({ added: drafts.length, truncated: Boolean(data.truncated) });
            setUrl("");
        } catch {
            setError("Could not import that playlist");
        } finally {
            setLoading(false);
        }
    }

    if (!enabled) {
        return (
            <p className="rounded-lg border border-dashed border-border bg-bg-soft-2/50 px-4 py-6 text-center text-sm text-fg-muted">
                Spotify import isn&apos;t configured on this deployment. Use the Paste or Search tabs
                instead.
            </p>
        );
    }

    return (
        <div className="space-y-3">
            <label htmlFor="spotify-url" className="sr-only">
                Spotify playlist link
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
                <input
                    id="spotify-url"
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://open.spotify.com/playlist/..."
                    className="input"
                />
                <button
                    type="button"
                    onClick={handleImport}
                    disabled={!url.trim() || loading}
                    className="btn-primary shrink-0"
                >
                    {loading ? "Importing…" : "Import"}
                </button>
            </div>
            <p className="text-xs text-fg-muted">Works with any public playlist link.</p>

            {error && (
                <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                    {error}
                </p>
            )}
            {summary && (
                <p className="text-xs text-fg-muted">
                    Added {summary.added} song{summary.added === 1 ? "" : "s"}.
                    {summary.truncated && " The playlist was longer than the tournament size limit, so it was cut off."}
                </p>
            )}
        </div>
    );
}
