"use client";

import { useState } from "react";

interface RankedSong {
    title: string;
    artist: string;
}

/**
 * Where the songs go.
 *
 * Soundiiz and TuneMyMusic both take a pasted list of tracks and build a
 * playlist on Spotify, Apple Music, YouTube Music and the rest. Two rather
 * than one because they have different free-tier limits and different ideas
 * of how many tracks you may convert at once, and a list of two hundred songs
 * runs into whichever one it happens to meet first.
 */
const CONVERTERS = [
    {
        name: "Soundiiz",
        url: "https://soundiiz.com/",
        note: "Paste as a new playlist, then send it to Spotify, Apple Music or YouTube Music.",
    },
    {
        name: "TuneMyMusic",
        url: "https://www.tunemymusic.com/",
        note: "Choose “Let's start”, pick a text/CSV source, and paste.",
    },
];

/**
 * The list, formatted for something that has to look each line up again.
 *
 * "Title - Artist", one per line, plain hyphen, NO rank numbers. Every part of
 * that is deliberate and none of it matches the human-readable export beside
 * it, which is why this is its own button rather than a second use of that
 * one:
 *
 *   - A leading "1." becomes part of the title as far as a matcher is
 *     concerned, and searching for "1. Africa" finds nothing.
 *   - The em dash in the plain-text export is a character these importers
 *     split on inconsistently; the ASCII hyphen is the separator they all
 *     document.
 *   - Order is carried by the LINE ORDER, which every converter preserves, so
 *     nothing is lost by dropping the numbers.
 *
 * A song with no credited artist is emitted as the bare title rather than
 * "Title - ", which would have the importer searching for an empty artist.
 */
function converterList(ranked: RankedSong[]): string {
    return ranked.map((s) => (s.artist ? `${s.title} - ${s.artist}` : s.title)).join("\n");
}

/**
 * A handoff, not an integration.
 *
 * SongRank used to build the Spotify playlist itself. That is gone: it needed
 * an OAuth connection, stored tokens, a match-review step and a cache, and all
 * of it sat behind Spotify's development-mode quota, which a two-hundred-song
 * ranking exhausts in one run and is then locked out of for the best part of a
 * day. The feature worked; it just could not be used. Lifting the quota is a
 * review Spotify may or may not grant, and the app should not be carrying an
 * account connection and two tables on that hope.
 *
 * So the honest version is this: hand the list over in the format a converter
 * wants, and say plainly that the playlist gets made somewhere else. The
 * result for a person is one paste further away, and it works today, for every
 * music service rather than just the one.
 */
export default function PlaylistHandoff({ ranked }: { ranked: RankedSong[] }) {
    const [copied, setCopied] = useState(false);

    async function copyForConverter() {
        try {
            await navigator.clipboard.writeText(converterList(ranked));
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Clipboard blocked or unavailable. The textarea below is the
            // fallback and is always rendered, so there is nothing to recover
            // from here -- and nothing worth alarming anyone about.
        }
    }

    return (
        <div className="card space-y-4 p-4 sm:p-5">
            <div>
                <h2 className="font-semibold">Turn this into a playlist</h2>
                <p className="mt-1 text-sm text-fg-muted">
                    Copy the list, then paste it into one of these. They&apos;ll build the playlist on Spotify,
                    Apple Music, YouTube Music or wherever you listen — in this order.
                </p>
            </div>

            <div className="flex flex-wrap gap-2">
                <button type="button" onClick={copyForConverter} className="btn-secondary">
                    {copied ? "Copied!" : `Copy ${ranked.length} songs`}
                </button>
                {CONVERTERS.map((c) => (
                    <a
                        key={c.name}
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-ghost"
                    >
                        Open {c.name} ↗
                    </a>
                ))}
            </div>

            <ul className="space-y-1 text-xs text-fg-muted">
                {CONVERTERS.map((c) => (
                    <li key={c.name}>
                        <strong className="text-fg">{c.name}</strong> — {c.note}
                    </li>
                ))}
            </ul>

            {/* Always rendered, not hidden behind a failure: clipboard access
                is blocked often enough (an insecure origin, a locked-down
                browser, an in-app webview) that a copy button with no visible
                fallback is a dead end for the people least able to diagnose
                it. */}
            <details>
                <summary className="cursor-pointer text-sm text-fg-muted">
                    Or select and copy it here
                </summary>
                <textarea
                    readOnly
                    value={converterList(ranked)}
                    rows={Math.min(10, Math.max(3, ranked.length))}
                    className="input mt-2 font-mono text-xs"
                    onFocus={(e) => e.currentTarget.select()}
                />
            </details>

            <p className="text-xs text-fg-muted">
                Neither service is run by SongRank, and nothing about your ranking is sent to them by us — you
                paste it yourself, so what they receive is whatever is on your clipboard.
            </p>
        </div>
    );
}
