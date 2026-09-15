"use client";

import { useMemo, useRef, useState } from "react";
import type { ClipSeconds, SearchResult, Song } from "@/lib/types";
import ClipPlayer from "./ClipPlayer";
import SongArt from "./SongArt";

/**
 * The pre-flight step between "build your list" and "start the tournament" --
 * problem 2 in the brief. The user's own words: "you can get 120 picks in and
 * finally run into a song that didn't find a linked audio file. That is
 * unacceptable." This screen makes every song's preview status (and, for
 * anything wrong, a fix) visible *before* a single matchup is played.
 *
 * Lives as an in-memory step inside NewTournament rather than its own route
 * (`/new/check`) on purpose: a route would need the whole draft song list --
 * up to MAX_SONGS entries, several of them with an artwork URL -- to survive
 * a navigation with no server-side draft storage to put it in. Keeping it as
 * a second client-side view of the same component state avoids inventing a
 * serialization format (query string, sessionStorage, ...) for something
 * that only ever needs to exist for the seconds between "build" and "start."
 *
 * Pagination (not a virtualization library -- there isn't one in
 * package.json, and this doesn't need one) keeps the number of simultaneously
 * mounted <audio> elements bounded regardless of how large the tournament is;
 * ClipPlayer's shared `activeAudioRef` (same prop it already takes on the
 * matchup screen) keeps playback to one clip at a time within a page.
 */

const PAGE_SIZE = 20;

export default function PreflightCheck({
    songs,
    clipSeconds,
    onChange,
    onBack,
    onStart,
    starting,
}: {
    songs: Song[];
    clipSeconds: ClipSeconds;
    onChange: (songs: Song[]) => void;
    onBack: () => void;
    onStart: () => void;
    starting: boolean;
}) {
    const activeAudioRef = useRef<HTMLAudioElement | null>(null);
    const [page, setPage] = useState(0);

    const missingCount = useMemo(() => songs.filter((s) => !s.previewUrl).length, [songs]);

    // Missing-preview songs first, has-preview songs after. Array.prototype.sort
    // is stable (guaranteed since ES2019), so within each group songs keep
    // their original order -- this is purely a "surface the risky ones"
    // reorder, never a shuffle a user has to re-orient around.
    const ordered = useMemo(
        () => [...songs].sort((a, b) => Number(Boolean(a.previewUrl)) - Number(Boolean(b.previewUrl))),
        [songs]
    );

    const totalPages = Math.max(1, Math.ceil(ordered.length / PAGE_SIZE));
    const currentPage = Math.min(page, totalPages - 1);
    const pageItems = ordered.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

    function replaceSong(id: string, result: SearchResult) {
        onChange(
            songs.map((s) =>
                s.id === id
                    ? {
                          ...s,
                          title: result.title,
                          artist: result.artist,
                          artworkUrl: result.artworkUrl,
                          previewUrl: result.previewUrl,
                          previewSeconds: result.previewSeconds,
                          previewNote: result.previewUrl ? null : "No preview available for this track.",
                          // A replacement is a different track from whatever
                          // Spotify export it might have come from -- the old
                          // spotifyUri would point at the wrong song.
                          spotifyUri: null,
                      }
                    : s
            )
        );
    }

    function removeSong(id: string) {
        onChange(songs.filter((s) => s.id !== id));
    }

    if (songs.length === 0) {
        return (
            <div className="card p-4 text-center sm:p-5">
                <p className="text-sm text-fg-muted">Every song was removed. Go back and add some to start a tournament.</p>
                <button type="button" onClick={onBack} className="btn-secondary mt-3">
                    Back to editing
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {missingCount === 0 ? (
                // The clean-list case: a single prominent affordance so a
                // paste that already checks out doesn't feel like a chore to
                // click through -- see the brief's "don't make a clean list
                // feel like a chore."
                <div className="card border-success/30 bg-success/10 p-4 text-center sm:p-5">
                    <p className="font-semibold text-fg">
                        All {songs.length} song{songs.length === 1 ? "" : "s"} have previews.
                    </p>
                    <button
                        type="button"
                        onClick={onStart}
                        disabled={starting}
                        className="btn-primary mt-3 w-full text-base sm:w-auto sm:px-8"
                    >
                        {starting ? "Starting…" : "Start tournament"}
                    </button>
                </div>
            ) : (
                <div className="card border-danger/30 bg-danger/10 p-4 sm:p-5">
                    <p className="font-semibold text-fg">
                        {missingCount} of {songs.length} song{songs.length === 1 ? "" : "s"} have no preview.
                    </p>
                    <p className="mt-1 text-sm text-fg-muted">
                        They&apos;re listed first below. Replace or remove them, or start anyway -- a song with no
                        clip is still fully votable by title and artist alone.
                    </p>
                </div>
            )}

            <ul className="space-y-2">
                {pageItems.map((song) => (
                    <SongRow
                        key={song.id}
                        song={song}
                        clipSeconds={clipSeconds}
                        activeAudioRef={activeAudioRef}
                        onReplace={replaceSong}
                        onRemove={removeSong}
                    />
                ))}
            </ul>

            {totalPages > 1 && (
                <div className="flex items-center justify-between text-sm">
                    <button
                        type="button"
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                        disabled={currentPage === 0}
                        className="btn-ghost !px-3 !py-1.5 text-xs"
                    >
                        ← Previous
                    </button>
                    <span className="text-xs text-fg-muted">
                        Page {currentPage + 1} of {totalPages}
                    </span>
                    <button
                        type="button"
                        onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                        disabled={currentPage >= totalPages - 1}
                        className="btn-ghost !px-3 !py-1.5 text-xs"
                    >
                        Next →
                    </button>
                </div>
            )}

            <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <p className="text-sm text-fg-muted">
                    {songs.length} song{songs.length === 1 ? "" : "s"} ready
                    {missingCount > 0 && `, ${missingCount} without a preview`}.
                </p>
                <div className="flex gap-2">
                    <button type="button" onClick={onBack} disabled={starting} className="btn-secondary">
                        Back to editing
                    </button>
                    <button type="button" onClick={onStart} disabled={starting} className="btn-primary">
                        {starting ? "Starting…" : "Start tournament"}
                    </button>
                </div>
            </div>
        </div>
    );
}

function SongRow({
    song,
    clipSeconds,
    activeAudioRef,
    onReplace,
    onRemove,
}: {
    song: Song;
    clipSeconds: ClipSeconds;
    activeAudioRef: React.MutableRefObject<HTMLAudioElement | null>;
    onReplace: (id: string, result: SearchResult) => void;
    onRemove: (id: string) => void;
}) {
    const [searching, setSearching] = useState(false);
    const [term, setTerm] = useState("");
    const [results, setResults] = useState<SearchResult[]>([]);
    const [loading, setLoading] = useState(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const requestIdRef = useRef(0);

    function handleTermChange(value: string) {
        setTerm(value);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (!value.trim()) {
            setResults([]);
            setLoading(false);
            return;
        }
        debounceRef.current = setTimeout(async () => {
            const requestId = ++requestIdRef.current;
            setLoading(true);
            try {
                const res = await fetch(`/api/songs/search?term=${encodeURIComponent(value)}`);
                const data = await res.json();
                if (requestId === requestIdRef.current) setResults(data.results ?? []);
            } catch {
                if (requestId === requestIdRef.current) setResults([]);
            } finally {
                if (requestId === requestIdRef.current) setLoading(false);
            }
        }, 300);
    }

    function closeSearch() {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        setSearching(false);
        setTerm("");
        setResults([]);
    }

    const missing = !song.previewUrl;

    return (
        <li className={`rounded-lg border p-3 ${missing ? "border-danger/40 bg-danger/5" : "border-border"}`}>
            <div className="flex items-start gap-3">
                <SongArt title={song.title} artworkUrl={song.artworkUrl} size={48} />
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{song.title || "Untitled"}</p>
                    <p className="truncate text-xs text-fg-muted">{song.artist || "Unknown artist"}</p>
                    <div className="mt-2">
                        <ClipPlayer
                            previewUrl={song.previewUrl}
                            previewSeconds={song.previewSeconds}
                            previewNote={song.previewNote}
                            clipSeconds={clipSeconds}
                            activeAudioRef={activeAudioRef}
                            label={song.title || "song"}
                        />
                    </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                    <button
                        type="button"
                        onClick={() => (searching ? closeSearch() : setSearching(true))}
                        className="btn-ghost !px-2 !py-1.5 text-xs"
                    >
                        {searching ? "Cancel" : "Replace"}
                    </button>
                    <button
                        type="button"
                        onClick={() => onRemove(song.id)}
                        className="btn-ghost !px-2 !py-1.5 text-xs text-danger"
                        aria-label={`Remove ${song.title || "song"}`}
                    >
                        Remove
                    </button>
                </div>
            </div>

            {searching && (
                <div className="mt-3 border-t border-border pt-3">
                    <label htmlFor={`replace-${song.id}`} className="sr-only">
                        Search for the correct track
                    </label>
                    <input
                        id={`replace-${song.id}`}
                        type="search"
                        autoFocus
                        value={term}
                        onChange={(e) => handleTermChange(e.target.value)}
                        placeholder="Search for the correct track…"
                        className="input text-sm"
                    />
                    {loading && <p className="mt-2 text-xs text-fg-muted">Searching…</p>}
                    {!loading && term.trim() && results.length === 0 && (
                        <p className="mt-2 text-xs text-fg-muted">No results for &quot;{term}&quot;.</p>
                    )}
                    <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
                        {results.map((r, i) => (
                            <li key={`${r.itunesId ?? i}-${r.title}-${r.artist}`}>
                                <button
                                    type="button"
                                    onClick={() => {
                                        onReplace(song.id, r);
                                        closeSearch();
                                    }}
                                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-bg-soft-2"
                                >
                                    <SongArt title={r.title} artworkUrl={r.artworkUrl} size={32} />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm">{r.title}</span>
                                        <span className="block truncate text-xs text-fg-muted">{r.artist}</span>
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </li>
    );
}
