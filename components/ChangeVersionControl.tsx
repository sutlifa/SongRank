"use client";

import { useEffect, useRef, useState } from "react";
import type { ClipSeconds, SearchResult, Song } from "@/lib/types";
import SongArt from "./SongArt";
import ClipPlayer from "./ClipPlayer";

/**
 * "Change version" -- lets a tournament organizer swap which *recording* a
 * song entry points to (audio, artwork, and the title/artist text that names
 * that recording) without touching the entry's identity, so every vote
 * already cast against it stays valid. See lib/songVersion.ts for the swap
 * itself and the invariant it rests on.
 *
 * Self-contained: owns its own open/closed and search state, so both call
 * sites (SongCard on the matchup screen, ResultsView on the results screen)
 * just render `<ChangeVersionControl ... />` and hand it an `onPick`
 * callback -- neither needs to know anything about search debouncing or the
 * panel's chrome. Reuses ClipPlayer for audition rather than reimplementing
 * playback, and takes the *same* `activeAudioRef` the caller already passes
 * to its own ClipPlayer(s), so opening this and playing a candidate stops
 * whatever matchup clip was already running, and only one candidate plays
 * at a time here too -- one shared slot, same as everywhere else in the app.
 */
export default function ChangeVersionControl({
    song,
    clipSeconds,
    activeAudioRef,
    onPick,
}: {
    song: Song;
    clipSeconds: ClipSeconds;
    activeAudioRef: React.MutableRefObject<HTMLAudioElement | null>;
    onPick: (version: SearchResult) => void;
}) {
    const [open, setOpen] = useState(false);
    const [term, setTerm] = useState("");
    const [results, setResults] = useState<SearchResult[]>([]);
    const [loading, setLoading] = useState(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const requestIdRef = useRef(0);
    const titleId = `change-version-title-${song.id}`;
    const searchId = `change-version-search-${song.id}`;

    // Seed the query from this song's current title + artist every time the
    // panel opens, not just once on mount -- reopening it (for this song
    // again, or after picking a version and reopening for a neighbour)
    // should always start from that song's own text, not whatever query was
    // last typed. The user can still edit it freely: "the studio version" of
    // a song currently seeded as "Let It Go (Live)" often needs different
    // words than the live take does.
    // Deferred a tick past the effect's own body -- same pattern
    // useTournamentLoader.tsx and TournamentPlayer.tsx already use for a
    // synchronous setState inside an effect (see either file's header for
    // why: react-hooks v7 flags a same-tick setState-in-effect as a hard
    // lint error, not just a style nit -- bug #7 in CLAUDE.md's paid-for list).
    useEffect(() => {
        if (!open) return;
        const timer = setTimeout(() => setTerm(`${song.title} ${song.artist}`.trim()), 0);
        return () => clearTimeout(timer);
    }, [open, song.title, song.artist]);

    useEffect(() => {
        if (!open) return;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (!term.trim()) {
            const timer = setTimeout(() => setResults([]), 0);
            return () => clearTimeout(timer);
        }
        debounceRef.current = setTimeout(async () => {
            const requestId = ++requestIdRef.current;
            setLoading(true);
            try {
                const res = await fetch(`/api/songs/search?term=${encodeURIComponent(term)}`);
                const data = await res.json();
                // Ignore a response to a since-superseded request -- same
                // guard SearchImportTab uses, for the same reason (typing
                // fast can let an older, slower response land after a newer
                // one and flash stale results).
                if (requestId === requestIdRef.current) setResults(data.results ?? []);
            } catch {
                if (requestId === requestIdRef.current) setResults([]);
            } finally {
                if (requestId === requestIdRef.current) setLoading(false);
            }
        }, 350);
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [term, open]);

    useEffect(() => {
        if (!open) return;
        function onKeyDown(e: KeyboardEvent) {
            if (e.key === "Escape") setOpen(false);
        }
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [open]);

    function handlePick(result: SearchResult) {
        onPick(result);
        setOpen(false);
    }

    return (
        <>
            {/* Deliberately a small, ghost-styled text button -- this is a
                secondary action that has to be reachable exactly when the
                user notices a recording is wrong (mid-comparison), but must
                never compete visually with the vote buttons or be an easy
                mis-click while voting. Callers place it away from the "Pick"
                button for that same reason. */}
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="btn-ghost shrink-0 !px-2 !py-1 text-[11px]"
                aria-label={`Change version of ${song.title}`}
                title="Swap the recording -- keeps this entry's votes"
            >
                Change version
            </button>

            {open && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby={titleId}
                    onClick={() => setOpen(false)}
                >
                    <div
                        className="card flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between gap-3 border-b border-border p-4">
                            <h2 id={titleId} className="min-w-0 truncate text-base font-bold">
                                Change version of &quot;{song.title}&quot;
                            </h2>
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                className="btn-ghost shrink-0 !px-2 !py-1"
                                aria-label="Close"
                            >
                                ✕
                            </button>
                        </div>

                        {/* The whole reason this button is safe to show mid-vote:
                            a user who fears losing hundreds of votes will not
                            touch it otherwise, so this has to be the first
                            thing seen, not a footnote. */}
                        <p className="border-b border-border bg-accent/10 px-4 py-3 text-sm text-fg">
                            <span className="font-semibold text-accent">Your votes are kept.</span> This only
                            changes which recording plays for this entry -- the ranking is untouched.
                        </p>

                        <div className="p-4 pb-2">
                            <label htmlFor={searchId} className="sr-only">
                                Search for a different recording
                            </label>
                            <input
                                id={searchId}
                                type="search"
                                autoFocus
                                value={term}
                                onChange={(e) => setTerm(e.target.value)}
                                placeholder="Search for a different recording…"
                                className="input"
                            />
                        </div>

                        <div className="flex-1 overflow-y-auto px-2 pb-4">
                            {loading && <p className="px-2 py-3 text-sm text-fg-muted">Searching…</p>}
                            {!loading && term.trim() && results.length === 0 && (
                                <p className="px-2 py-3 text-sm text-fg-muted">No results for &quot;{term}&quot;.</p>
                            )}
                            <ul className="space-y-1">
                                {results.map((r, i) => (
                                    <li
                                        key={`${r.itunesId ?? i}-${r.title}|${r.artist}`}
                                        className="flex items-start gap-3 rounded-lg p-2 hover:bg-bg-soft-2"
                                    >
                                        <SongArt title={r.title} artworkUrl={r.artworkUrl} size={44} />
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-sm font-medium" title={r.title}>
                                                {r.title}
                                            </p>
                                            <p className="truncate text-xs text-fg-muted" title={r.artist}>
                                                {r.artist}
                                                {r.album ? ` · ${r.album}` : ""}
                                            </p>
                                            <div className="mt-1.5 max-w-56">
                                                <ClipPlayer
                                                    previewUrl={r.previewUrl}
                                                    previewSeconds={r.previewSeconds}
                                                    previewNote={r.previewUrl ? null : "No preview available for this recording."}
                                                    clipSeconds={clipSeconds}
                                                    activeAudioRef={activeAudioRef}
                                                    label={`${r.title} candidate`}
                                                />
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handlePick(r)}
                                            className="btn-secondary mt-0.5 shrink-0 !px-3 !py-1.5 text-xs"
                                        >
                                            Use this
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
