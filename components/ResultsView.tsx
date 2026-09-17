"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { deriveTournament } from "@/lib/tournamentEngine";
import { prepareSongQuery, songMatchesQuery } from "@/lib/songFilter";
import SongArt from "./SongArt";
import ClipPlayer from "./ClipPlayer";
import ExportPanel from "./ExportPanel";
import EditableTournamentName from "./EditableTournamentName";
import { useTournamentLoader } from "./useTournamentLoader";
import VisibilityToggle from "./VisibilityToggle";
import type { Visibility } from "@/lib/queries";

/**
 * The finished ranking.
 *
 * Note what is deliberately NOT here: the "Change version" panel, which this
 * screen used to carry on the reasoning that reviewing the final list is
 * exactly when a bad recording gets noticed. True, and beside the point --
 * a finished ranking is a record of what somebody actually listened to. Every
 * one of those matchups was decided against a specific recording, so swapping
 * one in afterwards silently rewrites the question those votes answered: the
 * standings would still say this version beat that one nine times, about a
 * version nobody heard. The recording is fixed at the moment the ranking
 * completes, and the place to fix a bad one is while it is still being played
 * (see SongCard, which still has the panel) or in a new ranking.
 */
export default function ResultsView({
    id,
    authEnabled,
    visibility = null,
}: {
    id: string;
    authEnabled: boolean;
    /**
     * This ranking's current visibility, when the viewer owns a saved copy of
     * it -- resolved server-side by the results page. Null means the question
     * doesn't apply here (signed out, no database, or a ranking that only ever
     * lived in this tab), and the sharing panel is left out entirely rather
     * than offering a switch that couldn't do anything.
     */
    visibility?: Visibility | null;
}) {
    const router = useRouter();
    const { tournament, resolved, sync, renameTournament, refreshSongPreview } = useTournamentLoader(id, authEnabled);
    const activeAudioRef = useRef<HTMLAudioElement | null>(null);
    /**
     * The results filter. A finished ranking is a long ordered list -- a
     * couple of hundred rows is ordinary -- and "where did my song end up"
     * is the single most common thing anyone comes back to it for. Scrolling
     * for it is the wrong answer when a text box is three lines of code.
     *
     * Deliberately filters rather than re-sorts or scroll-jumps: the rank
     * numbers are the content of this page, so a match has to keep showing
     * the one it actually earned (see `standing.rank` below, which comes off
     * the full standings and is never recomputed from the filtered array).
     */
    const [query, setQuery] = useState("");

    const derived = useMemo(() => (tournament ? deriveTournament(tournament) : null), [tournament]);

    // Results only make sense once a champion has actually been decided --
    // an in-progress tournament belongs back on the matchup screen.
    useEffect(() => {
        if (derived && derived.status !== "complete") router.replace(`/t/${id}`);
    }, [derived, id, router]);

    if (!resolved) {
        return (
            <div className="mx-auto max-w-3xl px-4 py-16 text-center text-fg-muted sm:px-6">
            {/* `sync` MUST render in every branch, this one included.
                With `authEnabled`, useTournamentLoader deliberately leaves
                `resolved` false and waits for TournamentServerSync -- which
                IS `sync` -- to call onServerResolved. Returning early without
                rendering it deadlocks a signed-in user on this very screen
                forever: resolved can't flip until sync mounts, and sync can't
                mount until resolved flips. Keeping it mounted in all branches
                also stops its internal resolvedRef from being reset by an
                unmount/remount as the branches switch. */}
            {sync}
                Loading results…
            </div>
        );
    }

    if (!tournament || !derived || derived.status !== "complete") {
        return (
            <div className="mx-auto max-w-lg px-4 py-16 text-center sm:px-6">
                {sync}
                <h1 className="mb-2 text-xl font-bold">Results not found</h1>
                <p className="mb-6 text-sm text-fg-muted">
                    This link doesn&apos;t match a finished ranking on this device
                    {authEnabled ? " or your saved history" : ""}.
                </p>
                <Link href="/new" className="btn-primary">
                    Start a new ranking
                </Link>
            </div>
        );
    }

    const songById = new Map(tournament.songs.map((s) => [s.id, s]));

    // See lib/songFilter.ts for what counts as a match, and why it is
    // stricter than the catalogue search in lib/itunes.ts.
    const preparedQuery = prepareSongQuery(query);
    const visible = derived.standings.filter((standing) => songMatchesQuery(songById.get(standing.songId)!, preparedQuery));
    const ranked = derived.standings.map((s) => {
        const song = songById.get(s.songId)!;
        return { title: song.title, artist: song.artist };
    });

    return (
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
            {sync}

            <header className="mb-6">
                <EditableTournamentName name={tournament.name} onRename={renameTournament} />
                <p className="mt-1 text-sm text-fg-muted">
                    {tournament.songs.length} songs · {tournament.votes.length} matchups played
                </p>
            </header>

            {visibility !== null && (
                <section className="mb-6">
                    <h2 className="mb-2 text-sm font-semibold text-fg-muted">Who can see this</h2>
                    <VisibilityToggle tournamentId={id} initial={visibility} />
                </section>
            )}

            <div className="mb-6">
                <ExportPanel tournamentName={tournament.name} ranked={ranked} />
            </div>

            {/* Below the export panel, directly above the list it filters --
                a search box that floats away from its results reads as a
                site-wide search, which this very much is not. */}
            <div className="mb-4">
                <label htmlFor="results-filter" className="sr-only">
                    Find a song in this ranking
                </label>
                <div className="relative">
                    <input
                        id="results-filter"
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Find a song…"
                        className="input w-full pr-20"
                        autoComplete="off"
                    />
                    {query.trim() !== "" && (
                        <span
                            className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-mono text-xs tabular-nums text-fg-muted"
                            aria-live="polite"
                        >
                            {visible.length}/{derived.standings.length}
                        </span>
                    )}
                </div>
            </div>

            {visible.length === 0 && (
                <p className="card p-6 text-center text-sm text-fg-muted">
                    No song in this ranking matches “{query.trim()}”.{" "}
                    <button type="button" onClick={() => setQuery("")} className="underline underline-offset-2 hover:text-fg">
                        Clear the search
                    </button>{" "}
                    to see all {derived.standings.length}.
                </p>
            )}

            <ol className="space-y-3">
                {visible.map((standing) => {
                    const song = songById.get(standing.songId)!;
                    const isChampion = song.id === derived.championId;
                    return (
                        <li
                            key={song.id}
                            className={`card p-4 ${isChampion ? "border-accent/50 bg-gradient-to-br from-accent/10 to-transparent" : ""}`}
                        >
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                                {/* min-w-0 is load-bearing, not decoration.
                                    A flex item defaults to min-width:auto,
                                    which refuses to shrink below its content
                                    -- so the `truncate` on the title and
                                    artist below never fired, and a long
                                    credit ("Carolina Gaitan - La Gaita, Mauro
                                    Castillo, Adassa, ...", which is one real
                                    row of a Disney ranking) stretched this
                                    group until it shoved the player out past
                                    the edge of the card. Every row then had
                                    its play button in a different place.
                                    flex-1 lets it take the slack when the
                                    text is short. */}
                                <div className="flex min-w-0 flex-1 items-center gap-3">
                                    <span className="w-7 shrink-0 text-center text-lg font-bold text-fg-muted">
                                        {isChampion ? "👑" : standing.rank}
                                    </span>
                                    <SongArt title={song.title} artworkUrl={song.artworkUrl} size={56} />
                                    <div className="min-w-0">
                                        <p className="truncate font-semibold" title={song.title}>
                                            {song.title}
                                        </p>
                                        <p className="truncate text-sm text-fg-muted" title={song.artist}>
                                            {song.artist || "Unknown artist"}
                                        </p>
                                        <p className="mt-0.5 font-mono text-xs text-fg-muted">
                                            {standing.recordLabel} · {standing.detailLabel}
                                        </p>
                                    </div>
                                </div>

                                {/* shrink-0 for the same reason from the
                                    other side: the player has a fixed width
                                    and a progress bar in it, and must not be
                                    the thing that gives when a title is long. */}
                                <div className="flex shrink-0 items-start gap-2 sm:ml-auto">
                                    <div className="w-full sm:w-56">
                                        <ClipPlayer
                                            previewUrl={song.previewUrl}
                                            previewSeconds={song.previewSeconds}
                                            previewNote={song.previewNote}
                                            clipSeconds={tournament.clipSeconds}
                                            activeAudioRef={activeAudioRef}
                                            label={song.title}
                                            // A player per row, and nothing on
                                            // this screen is a comparison -- both
                                            // halves of why levelling is wrong
                                            // here. See `normalise` in
                                            // ClipPlayer's Props.
                                            normalise={false}
                                            // Apple moves preview files, so an
                                            // old ranking plays some clips and
                                            // not others. This repairs the link
                                            // without touching the recording;
                                            // see refreshSongPreview.
                                            onRepairPreview={() => refreshSongPreview(song.id)}
                                        />
                                    </div>
                                </div>
                            </div>
                        </li>
                    );
                })}
            </ol>

            <div className="mt-8 text-center">
                <Link href="/new" className="btn-secondary">
                    Start another ranking
                </Link>
            </div>
        </div>
    );
}
