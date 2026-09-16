"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { deriveTournament } from "@/lib/tournamentEngine";
import SongArt from "./SongArt";
import ClipPlayer from "./ClipPlayer";
import ExportPanel from "./ExportPanel";
import EditableTournamentName from "./EditableTournamentName";
import ChangeVersionControl from "./ChangeVersionControl";
import { useTournamentLoader } from "./useTournamentLoader";

export default function ResultsView({
    id,
    authEnabled,
}: {
    id: string;
    authEnabled: boolean;
}) {
    const router = useRouter();
    const { tournament, resolved, sync, renameTournament, changeSongVersion } = useTournamentLoader(id, authEnabled);
    const activeAudioRef = useRef<HTMLAudioElement | null>(null);

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

            <div className="mb-6">
                <ExportPanel tournamentName={tournament.name} ranked={ranked} />
            </div>

            <ol className="space-y-3">
                {derived.standings.map((standing) => {
                    const song = songById.get(standing.songId)!;
                    const isChampion = song.id === derived.championId;
                    return (
                        <li
                            key={song.id}
                            className={`card p-4 ${isChampion ? "border-accent/50 bg-gradient-to-br from-accent/10 to-transparent" : ""}`}
                        >
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                                <div className="flex items-center gap-3">
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

                                <div className="flex items-start gap-2 sm:ml-auto">
                                    <div className="sm:w-56">
                                        <ClipPlayer
                                            previewUrl={song.previewUrl}
                                            previewSeconds={song.previewSeconds}
                                            previewNote={song.previewNote}
                                            clipSeconds={tournament.clipSeconds}
                                            activeAudioRef={activeAudioRef}
                                            label={song.title}
                                        />
                                    </div>
                                    {/* Results is explicitly one of the two
                                        places this belongs (AGENT-TEAM.md
                                        brief): reviewing the final list is
                                        exactly when a bad recording gets
                                        noticed. */}
                                    <ChangeVersionControl
                                        song={song}
                                        clipSeconds={tournament.clipSeconds}
                                        activeAudioRef={activeAudioRef}
                                        onPick={(version) => changeSongVersion(song.id, version)}
                                    />
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
