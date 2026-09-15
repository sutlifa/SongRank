"use client";

import { useState } from "react";

interface RankedSong {
    title: string;
    artist: string;
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
 * Every export here works with no configuration and no account -- copy/CSV/
 * JSON are just the `ranked` array reformatted client-side. There used to be
 * a fourth option, a direct Spotify playlist export, but Spotify's API
 * blocks import of its own editorial playlists, a user-created public
 * playlist also failed to import, and export needed a full OAuth dance plus
 * a 25-user development-mode cap and a quota review to lift it -- not worth
 * the surface area for what it bought. Removed rather than fixed; see
 * AGENT-TEAM.md's history for the full reasoning if this ever comes up again.
 */
export default function ExportPanel({
    tournamentName,
    ranked,
}: {
    tournamentName: string;
    ranked: RankedSong[];
}) {
    const [copied, setCopied] = useState(false);

    const plainList = ranked.map((s) => (s.artist ? `${s.title} — ${s.artist}` : s.title)).join("\n");

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
            </div>

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
