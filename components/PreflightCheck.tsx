"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
 * A second, later report sharpened what "a fix" has to mean: "I just want to
 * make sure we are getting a working version that actually offers
 * suggestions for replacements, right now we are getting no suggestions for
 * the ones that are missing." A manual search box the user has to type into
 * themselves doesn't count -- so every row that needs attention now fetches
 * its own candidates automatically (see `useSuggestions` below) and shows
 * them as one-click picks. The manual box stays, as the fallback for when
 * none of the automatic suggestions are right.
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
 * mounted <audio> elements bounded regardless of how large the tournament is,
 * and is also what keeps the automatic suggestion fetch bounded: only the
 * current page's unmatched rows ever fetch, not all 256 songs on mount.
 * ClipPlayer's shared `activeAudioRef` (same prop it already takes on the
 * matchup screen) keeps playback to one clip at a time within a page.
 */

const PAGE_SIZE = 20;
/** At most this many suggestion lookups in flight at once -- see `useSuggestions`. */
const SUGGEST_CONCURRENCY = 3;

type SuggestionState = { status: "loading" } | { status: "loaded"; results: SearchResult[] } | { status: "error" };

export default function PreflightCheck({
    songs,
    weakSongIds,
    clipSeconds,
    onChange,
    onWeakResolved,
    onBack,
    onStart,
    starting,
}: {
    songs: Song[];
    /**
     * Ids of songs that resolved to only a "partial" iTunes match -- see
     * NewTournament's own doc comment on this set. These songs *have* a
     * previewUrl (draftToSong still filled one in) but the match is a guess
     * worth double-checking, so they get automatic suggestions the same as a
     * flat miss, not just the red "no preview" treatment.
     */
    weakSongIds: Set<string>;
    clipSeconds: ClipSeconds;
    onChange: (songs: Song[]) => void;
    /** Fired when a row that was in `weakSongIds` gets replaced, so the parent can drop it from that set. */
    onWeakResolved: (id: string) => void;
    onBack: () => void;
    onStart: () => void;
    starting: boolean;
}) {
    const activeAudioRef = useRef<HTMLAudioElement | null>(null);
    const [page, setPage] = useState(0);

    function isUnmatched(song: Song): boolean {
        return !song.previewUrl || weakSongIds.has(song.id);
    }

    const unmatchedCount = useMemo(
        () => songs.filter(isUnmatched).length,
        // isUnmatched is a plain function of songs/weakSongIds, redefined
        // every render -- listing it would defeat the memo entirely for no
        // benefit, since its own inputs are already the two deps below.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [songs, weakSongIds]
    );

    // Unmatched songs first, confirmed ones after. Array.prototype.sort is
    // stable (guaranteed since ES2019), so within each group songs keep
    // their original order -- this is purely a "surface the risky ones"
    // reorder, never a shuffle a user has to re-orient around.
    const ordered = useMemo(
        () => [...songs].sort((a, b) => Number(!isUnmatched(a)) - Number(!isUnmatched(b))),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [songs, weakSongIds]
    );

    const totalPages = Math.max(1, Math.ceil(ordered.length / PAGE_SIZE));
    const currentPage = Math.min(page, totalPages - 1);
    const pageItems = ordered.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

    const suggestions = useSuggestions(pageItems, isUnmatched);

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
        onWeakResolved(id);
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
            {unmatchedCount === 0 ? (
                // The clean-list case: a single prominent affordance so a
                // paste that already checks out doesn't feel like a chore to
                // click through -- see the brief's "don't make a clean list
                // feel like a chore."
                <div className="card border-success/30 bg-success/10 p-4 text-center sm:p-5">
                    <p className="font-semibold text-fg">
                        All {songs.length} song{songs.length === 1 ? "" : "s"} have a confident match.
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
                        {unmatchedCount} of {songs.length} song{songs.length === 1 ? "" : "s"} need a check.
                    </p>
                    <p className="mt-1 text-sm text-fg-muted">
                        They&apos;re listed first below, each with suggested replacements pulled automatically. Pick
                        one, search manually, or start anyway -- a song with no clip is still fully votable by title
                        and artist alone.
                    </p>
                </div>
            )}

            <ul className="space-y-2">
                {pageItems.map((song) => (
                    <SongRow
                        key={song.id}
                        song={song}
                        unmatched={isUnmatched(song)}
                        suggestion={suggestions[song.id]}
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
                    {unmatchedCount > 0 && `, ${unmatchedCount} to check`}.
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

/**
 * Fetches /api/songs/suggest for every unmatched song on the *current page
 * only*, with bounded concurrency -- the whole reason this isn't a plain
 * per-row `useEffect` is to cap the total number of in-flight lookups at
 * once regardless of how many unmatched rows the page has (up to PAGE_SIZE),
 * mirroring the same bounded-worker-pool shape NewTournament's own
 * `resolvePreviews` and lib/parse.ts's `resolveImportBatch` already use.
 *
 * Keyed by song id, not by page: a song already fetched keeps its cached
 * suggestions if it reappears (e.g. the page is revisited), so going back
 * and forth never re-fetches something already answered.
 */
function useSuggestions(pageItems: Song[], isUnmatched: (song: Song) => boolean) {
    const [suggestions, setSuggestions] = useState<Record<string, SuggestionState>>({});
    const cache = useRef(suggestions);
    cache.current = suggestions;

    // pageItems is a fresh array every render (it's a slice of `ordered`),
    // so the effect keys off the ids it actually contains rather than the
    // array reference -- otherwise it would re-run (harmlessly, thanks to
    // the `!cache.current[s.id]` guard below, but pointlessly) on every
    // render instead of only when the visible set of songs changes.
    const pageKey = pageItems.map((s) => s.id).join("|");

    useEffect(() => {
        const targets = pageItems.filter((s) => isUnmatched(s) && !cache.current[s.id]);
        if (targets.length === 0) return;

        let cancelled = false;

        // Mark every target "loading" up front (one batched update) so a
        // fast re-render of this effect doesn't see the same songs as
        // un-fetched and queue them twice.
        setSuggestions((prev) => {
            const next = { ...prev };
            for (const s of targets) next[s.id] = { status: "loading" };
            return next;
        });

        let cursor = 0;
        async function worker() {
            for (;;) {
                const index = cursor++;
                if (index >= targets.length) return;
                const song = targets[index];
                try {
                    const res = await fetch("/api/songs/suggest", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ title: song.title, artist: song.artist }),
                    });
                    const data = await res.json();
                    const results = ((data.suggestions ?? []) as { result: SearchResult }[]).map((s) => s.result);
                    if (!cancelled) setSuggestions((prev) => ({ ...prev, [song.id]: { status: "loaded", results } }));
                } catch {
                    if (!cancelled) setSuggestions((prev) => ({ ...prev, [song.id]: { status: "error" } }));
                }
            }
        }

        Promise.all(Array.from({ length: Math.min(SUGGEST_CONCURRENCY, targets.length) }, worker)).catch(() => {});

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pageKey]);

    return suggestions;
}

function SongRow({
    song,
    unmatched,
    suggestion,
    clipSeconds,
    activeAudioRef,
    onReplace,
    onRemove,
}: {
    song: Song;
    unmatched: boolean;
    suggestion: SuggestionState | undefined;
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

    return (
        <li className={`rounded-lg border p-3 ${unmatched ? "border-danger/40 bg-danger/5" : "border-border"}`}>
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
                        {searching ? "Cancel" : "Search manually"}
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

            {unmatched && !searching && (
                <div className="mt-3 border-t border-border pt-3">
                    <SuggestionPanel
                        song={song}
                        suggestion={suggestion}
                        activeAudioRef={activeAudioRef}
                        clipSeconds={clipSeconds}
                        onPick={(result) => onReplace(song.id, result)}
                        onSearchManually={() => setSearching(true)}
                    />
                </div>
            )}

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

/**
 * The automatic-suggestions block for one unmatched row: a loading state, a
 * short shelf of candidates (artwork, title, artist, an audition player, a
 * "Use this" pick), or a plain "no matches" message when the lookup
 * genuinely came back empty.
 */
function SuggestionPanel({
    song,
    suggestion,
    activeAudioRef,
    clipSeconds,
    onPick,
    onSearchManually,
}: {
    song: Song;
    suggestion: SuggestionState | undefined;
    activeAudioRef: React.MutableRefObject<HTMLAudioElement | null>;
    clipSeconds: ClipSeconds;
    onPick: (result: SearchResult) => void;
    onSearchManually: () => void;
}) {
    if (!suggestion || suggestion.status === "loading") {
        return (
            <p className="text-xs text-fg-muted">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-fg-muted align-middle" />{" "}
                Looking for suggestions…
            </p>
        );
    }

    if (suggestion.status === "error") {
        return (
            <p className="text-xs text-fg-muted">
                Couldn&apos;t reach Apple Music for suggestions.{" "}
                <button type="button" onClick={onSearchManually} className="underline underline-offset-2 hover:text-fg">
                    Search manually
                </button>{" "}
                instead.
            </p>
        );
    }

    if (suggestion.results.length === 0) {
        return (
            <p className="text-xs text-fg-muted">
                No matches found on Apple Music for &quot;{song.title}&quot;. You can{" "}
                <button type="button" onClick={onSearchManually} className="underline underline-offset-2 hover:text-fg">
                    search manually
                </button>{" "}
                or remove this song.
            </p>
        );
    }

    return (
        <div>
            <p className="mb-2 text-xs font-medium text-fg-muted">Suggested replacements</p>
            <ul className="space-y-1.5">
                {suggestion.results.map((r, i) => (
                    <li key={`${r.itunesId ?? i}-${r.title}-${r.artist}`} className="rounded-lg bg-bg-soft-2/60 p-2">
                        <div className="flex items-center gap-2">
                            <SongArt title={r.title} artworkUrl={r.artworkUrl} size={36} />
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm">{r.title}</p>
                                <p className="truncate text-xs text-fg-muted">{r.artist}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => onPick(r)}
                                className="btn-secondary shrink-0 !px-2.5 !py-1.5 text-xs"
                            >
                                Use this
                            </button>
                        </div>
                        {r.previewUrl && (
                            <div className="mt-2">
                                <ClipPlayer
                                    previewUrl={r.previewUrl}
                                    previewSeconds={r.previewSeconds}
                                    previewNote={null}
                                    clipSeconds={clipSeconds}
                                    activeAudioRef={activeAudioRef}
                                    label={r.title}
                                />
                            </div>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}
