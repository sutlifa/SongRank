"use client";

import { useState } from "react";
import { parseSongList, resolveImportBatch } from "@/lib/parse";
import type { SearchResult } from "@/lib/types";
import type { DraftSong } from "./NewTournament";

/**
 * Calls our own /api/songs/search route (never itunes.apple.com directly --
 * see lib/itunes.ts's header) with the whole raw pasted line as the search
 * term. This is the `SearchFn` lib/parse.ts's `resolveImportBatch` needs;
 * kept as a plain function rather than inline so it's obvious it's the only
 * network-touching piece of this file.
 */
async function searchForMatch(term: string): Promise<SearchResult[]> {
    const res = await fetch(`/api/songs/search?term=${encodeURIComponent(term)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results as SearchResult[] | undefined) ?? [];
}

/**
 * The paste tab: freeform text in, a parsed-and-matched batch out.
 *
 * Two passes happen here, not one: `parseSongList` (lib/parse.ts) is pure
 * and synchronous -- title/artist guesses from the text shape plus
 * cross-line frequency analysis, no I/O. `resolveImportBatch` is the
 * catalogue-lookup pass on top of that: every line's raw text is searched
 * against Apple Music, and a confident match replaces the guess outright and
 * clears its review flag. That second pass is what makes a clean 250-song
 * paste need close to zero manual review, instead of every ambiguous-looking
 * line -- see lib/parse.ts's header for the full reasoning.
 */
export default function PasteImportTab({ onAdd }: { onAdd: (songs: DraftSong[]) => void }) {
    const [text, setText] = useState("");
    const [matching, setMatching] = useState<{ done: number; total: number } | null>(null);
    const [summary, setSummary] = useState<{ added: number; duplicates: number; truncated: number; matched: number } | null>(
        null
    );

    async function handleParse() {
        setSummary(null);
        const result = parseSongList(text);
        if (result.songs.length === 0) {
            setSummary({ added: 0, duplicates: result.duplicates, truncated: result.truncated, matched: 0 });
            setText("");
            return;
        }

        setMatching({ done: 0, total: result.songs.length });
        const resolved = await resolveImportBatch(result.songs, searchForMatch, {
            onProgress: (done, total) => setMatching({ done, total }),
        });
        setMatching(null);

        let matched = 0;
        const drafts: DraftSong[] = resolved.map((s) => {
            const catalogueMatch = s.confidence === "high" ? s.matched : null;
            if (catalogueMatch) matched += 1;
            return {
                id: crypto.randomUUID(),
                title: s.title,
                artist: s.artist,
                ambiguous: s.ambiguous,
                // A high-confidence catalogue match already carries
                // artwork/preview -- filling it in now means NewTournament's
                // later resolve-before-start pass has nothing left to do for
                // this song (it only re-resolves songs with `resolved: null`).
                resolved: catalogueMatch
                    ? {
                          artworkUrl: catalogueMatch.artworkUrl,
                          previewUrl: catalogueMatch.previewUrl,
                          previewSeconds: catalogueMatch.previewSeconds,
                      }
                    : null,
                spotifyUri: null,
            };
        });

        onAdd(drafts);
        setSummary({ added: drafts.length, duplicates: result.duplicates, truncated: result.truncated, matched });
        setText("");
    }

    return (
        <div className="space-y-3">
            <label htmlFor="paste-songs" className="sr-only">
                Paste your song list
            </label>
            <textarea
                id="paste-songs"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={"Paste a list of songs, one per line, e.g.\nDaft Punk - Around the World\nBohemian Rhapsody by Queen\n1. Hotel California, Eagles"}
                rows={8}
                className="input font-mono text-sm"
            />
            <div className="flex items-center gap-3">
                <button type="button" onClick={handleParse} disabled={!text.trim() || Boolean(matching)} className="btn-primary">
                    {matching ? `Matching… ${matching.done}/${matching.total}` : "Parse list"}
                </button>
                <p className="text-xs text-fg-muted">
                    Handles &quot;Artist - Title&quot;, &quot;Title by Artist&quot;, tab-separated and Spotify/Apple
                    Music CSV exports, numbered/bulleted lists, and quotes. Each line is checked against Apple
                    Music&apos;s catalogue, so most songs won&apos;t need a manual check below.
                </p>
            </div>
            {summary && (
                <p className="text-xs text-fg-muted">
                    Added {summary.added} song{summary.added === 1 ? "" : "s"}.
                    {summary.matched > 0 &&
                        ` ${summary.matched} confirmed against Apple Music.`}
                    {summary.duplicates > 0 && ` Skipped ${summary.duplicates} duplicate${summary.duplicates === 1 ? "" : "s"}.`}
                    {summary.truncated > 0 && ` ${summary.truncated} more were cut off at the size limit.`}
                </p>
            )}
        </div>
    );
}
