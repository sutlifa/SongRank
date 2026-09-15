"use client";

import { useState } from "react";
import { parseSongList } from "@/lib/parse";
import type { DraftSong } from "./NewTournament";

/**
 * The paste tab: freeform text in, a parsed batch out. Parsing itself is
 * pure and runs client-side (lib/parse.ts has no I/O) -- only *resolving*
 * a parsed song to artwork/preview costs a network round trip, and that
 * happens later, once, when the tournament actually starts (see
 * NewTournament's `startTournament`), not on every keystroke here.
 */
export default function PasteImportTab({ onAdd }: { onAdd: (songs: DraftSong[]) => void }) {
    const [text, setText] = useState("");
    const [summary, setSummary] = useState<{ added: number; duplicates: number; truncated: number } | null>(null);

    function handleParse() {
        const result = parseSongList(text);
        const drafts: DraftSong[] = result.songs.map((s) => ({
            id: crypto.randomUUID(),
            title: s.title,
            artist: s.artist,
            ambiguous: s.ambiguous,
            resolved: null,
            spotifyUri: null,
        }));
        onAdd(drafts);
        setSummary({ added: drafts.length, duplicates: result.duplicates, truncated: result.truncated });
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
                <button type="button" onClick={handleParse} disabled={!text.trim()} className="btn-primary">
                    Parse list
                </button>
                <p className="text-xs text-fg-muted">
                    Handles &quot;Artist - Title&quot;, &quot;Title by Artist&quot;, numbered/bulleted lists, and
                    quotes. Dash-separated lines are flagged below for a quick check — we can&apos;t always
                    tell which side is the artist.
                </p>
            </div>
            {summary && (
                <p className="text-xs text-fg-muted">
                    Added {summary.added} song{summary.added === 1 ? "" : "s"}.
                    {summary.duplicates > 0 && ` Skipped ${summary.duplicates} duplicate${summary.duplicates === 1 ? "" : "s"}.`}
                    {summary.truncated > 0 && ` ${summary.truncated} more were cut off at the size limit.`}
                </p>
            )}
        </div>
    );
}
