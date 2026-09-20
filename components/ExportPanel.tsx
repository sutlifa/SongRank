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
 * Getting a finished ranking out, in one card.
 *
 * Every option here works with no configuration and no account -- they are
 * all just the `ranked` array reformatted client-side -- which is the
 * property worth protecting: a signed-out person with a finished ranking can
 * always get it out.
 *
 * The playlist links live HERE rather than in a card of their own. They had
 * their own card for about an hour, and it was two buttons and a textarea
 * that did what the two buttons and the textarea above them already did. A
 * second way to copy the same list is not a feature; the links are the only
 * part that was actually new, and they are one line.
 *
 * A direct Spotify playlist export was tried twice and removed twice. The
 * second attempt was complete and working -- OAuth, a match-review step, an
 * answer cache -- and still could not be used, because Spotify meters search
 * per application and the development-mode quota is spent by one long ranking
 * and then locked out for most of a day. Lifting it is a review Spotify may
 * not grant. If a third attempt is ever tempting: the blocker was never the
 * code.
 */

/**
 * Where the list goes to become a playlist.
 *
 * Two, not one: their free tiers cap how many tracks you may convert at once
 * at different points, and a two-hundred-song ranking meets whichever limit
 * it happens to hit first.
 */
const CONVERTERS = [
    { name: "Soundiiz", url: "https://soundiiz.com/" },
    { name: "TuneMyMusic", url: "https://www.tunemymusic.com/" },
];
export default function ExportPanel({
    tournamentName,
    ranked,
}: {
    tournamentName: string;
    ranked: RankedSong[];
}) {
    const [copied, setCopied] = useState(false);

    /**
     * "Title - Artist", one per line. Plain ASCII hyphen, no rank numbers.
     *
     * Both details are for the converters below, and they cost the reader
     * nothing. A leading "1." becomes part of the title as far as a matcher is
     * concerned, so "1. Africa" finds nothing; and the em dash this used to
     * use is a character those importers split on inconsistently, where the
     * hyphen is what they document. The ranking survives as the LINE ORDER,
     * which every converter preserves.
     *
     * A song with no credited artist is emitted bare rather than as
     * "Title - ", which would have an importer searching for an empty artist.
     */
    const plainList = ranked.map((s) => (s.artist ? `${s.title} - ${s.artist}` : s.title)).join("\n");

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

            {/* One line, under the buttons that produce the thing it asks you
                to paste. Anything more elaborate here was a second copy of
                the card above it. */}
            <p className="text-sm text-fg-muted">
                Paste the text into{" "}
                {CONVERTERS.map((c, i) => (
                    <span key={c.name}>
                        {i > 0 && " or "}
                        <a
                            href={c.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline underline-offset-2 hover:text-fg"
                        >
                            {c.name}
                        </a>
                    </span>
                ))}{" "}
                to turn it into a playlist on Spotify, Apple Music or YouTube Music — in this order. Neither
                service is ours, and SongRank sends them nothing; you paste it yourself.
            </p>

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
