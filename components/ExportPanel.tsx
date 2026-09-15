"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

interface RankedSong {
    title: string;
    artist: string;
    spotifyUri: string | null;
}

interface SpotifyExportResult {
    playlistUrl: string;
    matched: number;
    total: number;
    misses: { title: string; artist: string }[];
}

function downloadFile(filename: string, content: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function slugify(name: string): string {
    return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "songrank";
}

/**
 * Every export here except Spotify works with no configuration and no
 * account -- copy/CSV/JSON are just the `ranked` array reformatted client-
 * side. Spotify is the one that needs a real OAuth round trip, handled by
 * bouncing the whole page through /api/spotify/connect and back (see that
 * route and /api/spotify/callback) rather than a popup, which keeps this
 * component free of popup-blocker edge cases at the cost of a page reload.
 */
export default function ExportPanel({
    tournamentName,
    ranked,
    spotifyExportEnabled,
}: {
    tournamentName: string;
    ranked: RankedSong[];
    spotifyExportEnabled: boolean;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const [copied, setCopied] = useState(false);
    const [spotify, setSpotify] = useState<
        { status: "idle" } | { status: "exporting" } | { status: "done"; result: SpotifyExportResult } | { status: "error"; message: string }
    >({ status: "idle" });

    const plainList = ranked.map((s) => (s.artist ? `${s.title} — ${s.artist}` : s.title)).join("\n");

    const runExport = useCallback(async () => {
        setSpotify({ status: "exporting" });
        try {
            const res = await fetch("/api/spotify/export", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: `${tournamentName} (SongRank)`, songs: ranked }),
            });
            const data = await res.json();
            if (!res.ok) {
                if (res.status === 401) {
                    // Not connected yet, or the short-lived token expired --
                    // start (or restart) the OAuth round trip. This has to be a
                    // hard navigation, not router.push: the destination is a
                    // route handler that 302s off to Spotify's own consent
                    // screen and back, not a Next.js page the client router
                    // could transition to.
                    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                    window.location.href = `/api/spotify/connect?returnTo=${encodeURIComponent(pathname)}`;
                    return;
                }
                setSpotify({ status: "error", message: data.error ?? "Could not export to Spotify" });
                return;
            }
            setSpotify({ status: "done", result: data.result });
        } catch {
            setSpotify({ status: "error", message: "Could not export to Spotify" });
        }
    }, [tournamentName, ranked, pathname]);

    // Coming back from /api/spotify/callback: either finish the export the
    // click started, or show why it didn't happen. Either way, strip the
    // query param so a refresh doesn't repeat it.
    //
    // The actual work is deferred a tick past the effect's own body (rather
    // than calling router.replace/setSpotify synchronously inline) because
    // this is reacting to a one-time arrival condition -- "we were just
    // redirected here" -- not deriving anything from render inputs, which is
    // exactly the case React's set-state-in-effect check exists to flag as a
    // smell. Deferring it makes that explicit instead of suppressing the rule.
    useEffect(() => {
        const connected = searchParams.get("spotifyConnected");
        const error = searchParams.get("spotifyError");
        if (!connected && !error) return;

        const timer = setTimeout(() => {
            router.replace(pathname);
            if (connected) runExport();
            else if (error) setSpotify({ status: "error", message: error });
        }, 0);
        return () => clearTimeout(timer);
        // Intentionally only on mount -- this reads the URL exactly once, as
        // the landing state from a redirect, not on every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function copyText() {
        try {
            await navigator.clipboard.writeText(plainList);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Clipboard permission denied or unavailable -- the textarea below
            // is the fallback, so there's nothing else to do here.
        }
    }

    return (
        <div className="card space-y-4 p-4 sm:p-5">
            <h2 className="font-semibold">Export your ranking</h2>

            <div className="flex flex-wrap gap-2">
                <button type="button" onClick={copyText} className="btn-secondary">
                    {copied ? "Copied!" : "Copy as text"}
                </button>
                <button
                    type="button"
                    onClick={() =>
                        downloadFile(
                            `${slugify(tournamentName)}.csv`,
                            toCsv(ranked),
                            "text/csv"
                        )
                    }
                    className="btn-secondary"
                >
                    Download CSV
                </button>
                <button
                    type="button"
                    onClick={() =>
                        downloadFile(
                            `${slugify(tournamentName)}.json`,
                            JSON.stringify(ranked, null, 2),
                            "application/json"
                        )
                    }
                    className="btn-secondary"
                >
                    Download JSON
                </button>
                <button
                    type="button"
                    onClick={runExport}
                    disabled={!spotifyExportEnabled || spotify.status === "exporting"}
                    className="btn-primary"
                    title={spotifyExportEnabled ? undefined : "Spotify export isn't configured on this deployment"}
                >
                    {spotify.status === "exporting" ? "Exporting…" : "Export to Spotify"}
                </button>
            </div>
            {!spotifyExportEnabled && (
                <p className="text-xs text-fg-muted">
                    Spotify export isn&apos;t configured on this deployment — every export above still
                    works without it.
                </p>
            )}

            {spotify.status === "done" && (
                <div className="rounded-lg border border-success/30 bg-success/10 px-3 py-2.5 text-sm">
                    <p>
                        Matched {spotify.result.matched} of {spotify.result.total} songs.{" "}
                        <a
                            href={spotify.result.playlistUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="font-semibold text-accent underline underline-offset-2"
                        >
                            Open the playlist
                        </a>
                    </p>
                    {spotify.result.misses.length > 0 && (
                        <details className="mt-1.5">
                            <summary className="cursor-pointer text-fg-muted">
                                {spotify.result.misses.length} song{spotify.result.misses.length === 1 ? "" : "s"} didn&apos;t match
                            </summary>
                            <ul className="mt-1 list-inside list-disc text-fg-muted">
                                {spotify.result.misses.map((m, i) => (
                                    <li key={i}>
                                        {m.title} — {m.artist}
                                    </li>
                                ))}
                            </ul>
                        </details>
                    )}
                </div>
            )}
            {spotify.status === "error" && (
                <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger">
                    {spotify.message}
                </p>
            )}

            <details>
                <summary className="cursor-pointer text-sm text-fg-muted">Plain text list</summary>
                <textarea
                    readOnly
                    value={plainList}
                    rows={Math.min(10, ranked.length)}
                    className="input mt-2 font-mono text-xs"
                    onFocus={(e) => e.currentTarget.select()}
                />
            </details>
        </div>
    );
}

function toCsv(ranked: RankedSong[]): string {
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const header = "Rank,Title,Artist";
    const rows = ranked.map((s, i) => `${i + 1},${escape(s.title)},${escape(s.artist)}`);
    return [header, ...rows].join("\n");
}
