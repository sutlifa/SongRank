"use client";

import { useEffect, useRef, useState } from "react";
import type { SearchResult } from "@/lib/types";
import type { DraftSong } from "./NewTournament";
import SongArt from "./SongArt";

/**
 * The search tab. Results already carry artwork/preview straight from
 * /api/songs/search, so a song added here needs no later resolve step --
 * only a pasted entry does (see NewTournament).
 */
export default function SearchImportTab({ onAdd }: { onAdd: (songs: DraftSong[]) => void }) {
    const [term, setTerm] = useState("");
    const [results, setResults] = useState<SearchResult[]>([]);
    /** Whether the last search failed to reach Apple at all, as opposed to
     * reaching it and finding nothing -- see SearchOutcome in lib/itunes.ts. */
    const [unreachable, setUnreachable] = useState(false);
    /** The broader term that was also searched, when the exact one was sparse
     * -- see SearchOutcome in lib/itunes.ts. Shown so a widened search can
     * never pass itself off as an exact one. */
    const [broadenedTo, setBroadenedTo] = useState<string | null>(null);
    /** How many of the results came from the term as typed. */
    const [exactCount, setExactCount] = useState(0);
    const [loading, setLoading] = useState(false);
    const [added, setAdded] = useState<Set<string>>(new Set());
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const requestIdRef = useRef(0);

    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        // Nothing to search -- and nothing to clear synchronously either; an
        // empty term is handled entirely at render time below (`visibleResults`),
        // so a fast clear-then-retype can't flash a stale "no results" state
        // in between.
        if (!term.trim()) return;

        debounceRef.current = setTimeout(async () => {
            const requestId = ++requestIdRef.current;
            setLoading(true);
            try {
                const res = await fetch(`/api/songs/search?term=${encodeURIComponent(term)}`);
                const data = await res.json();
                // Ignore a response to a since-superseded request -- typing
                // fast can otherwise let an older, slower response land after
                // a newer one and flash stale results.
                if (requestId === requestIdRef.current) {
                    setResults(data.results ?? []);
                    setUnreachable(data.unreachable === true);
                    setBroadenedTo(typeof data.broadenedTo === "string" ? data.broadenedTo : null);
                    setExactCount(typeof data.exactCount === "number" ? data.exactCount : 0);
                }
            } catch {
                if (requestId === requestIdRef.current) {
                    setResults([]);
                    setUnreachable(true);
                    setBroadenedTo(null);
                    setExactCount(0);
                }
            } finally {
                if (requestId === requestIdRef.current) setLoading(false);
            }
        }, 350);
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [term]);

    const visibleResults = term.trim() ? results : [];
    const visibleLoading = term.trim() ? loading : false;
    const visibleUnreachable = term.trim() ? unreachable : false;
    const broadened = term.trim() ? broadenedTo : null;

    function handleAdd(result: SearchResult) {
        const key = `${result.title}|${result.artist}`;
        onAdd([
            {
                id: crypto.randomUUID(),
                title: result.title,
                artist: result.artist,
                ambiguous: false,
                resolved: {
                    artworkUrl: result.artworkUrl,
                    previewUrl: result.previewUrl,
                    previewSeconds: result.previewSeconds,
                },
            },
        ]);
        setAdded((prev) => new Set(prev).add(key));
    }

    return (
        <div className="space-y-3">
            <label htmlFor="search-songs" className="sr-only">
                Search for a song
            </label>
            <input
                id="search-songs"
                type="search"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Search for a song or artist…"
                className="input"
            />

            {visibleLoading && <p className="text-sm text-fg-muted">Searching…</p>}
            {/* An empty list has two very different causes, and saying "No
                results" for both is how a rate-limited search convinces
                someone their song isn't on Apple Music. */}
            {!visibleLoading && term.trim() && visibleResults.length === 0 && (
                visibleUnreachable ? (
                    <p className="text-sm text-danger">
                        Couldn&apos;t reach Apple Music just now — that&apos;s us, not your search.
                        Try again in a moment.
                    </p>
                ) : (
                    <p className="text-sm text-fg-muted">No results for &quot;{term}&quot;.</p>
                )
            )}

            {/* Two different things to say, and conflating them would mislead
                either way: nothing matched what you typed, versus a few did
                and here is more besides. */}
            {!visibleLoading && broadened && visibleResults.length > 0 && (
                <p className="mb-2 text-sm text-fg-muted">
                    {exactCount === 0 ? (
                        <>
                            Nothing matched &ldquo;{term.trim()}&rdquo; exactly — showing results for{" "}
                            <span className="font-medium text-fg">&ldquo;{broadened}&rdquo;</span>.
                        </>
                    ) : (
                        <>
                            Also showing results for{" "}
                            <span className="font-medium text-fg">&ldquo;{broadened}&rdquo;</span>.
                        </>
                    )}{" "}
                    Apple often lists a remix or version under a name you wouldn&apos;t guess.
                </p>
            )}

            <ul className="max-h-80 space-y-1 overflow-y-auto">
                {visibleResults.map((r, i) => {
                    const key = `${r.title}|${r.artist}`;
                    const isAdded = added.has(key);
                    return (
                        <li
                            key={`${r.itunesId ?? i}-${key}`}
                            className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-bg-soft-2"
                        >
                            <SongArt title={r.title} artworkUrl={r.artworkUrl} size={40} />
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">{r.title}</p>
                                <p className="truncate text-xs text-fg-muted">{r.artist}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => handleAdd(r)}
                                disabled={isAdded}
                                className="btn-secondary shrink-0 !px-3 !py-1.5 text-xs"
                            >
                                {isAdded ? "Added" : "Add"}
                            </button>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
