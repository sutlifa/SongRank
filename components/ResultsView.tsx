"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { derive, recordLabel } from "@/lib/swiss";
import SongArt from "./SongArt";
import ClipPlayer from "./ClipPlayer";
import ExportPanel from "./ExportPanel";
import { useTournamentLoader } from "./useTournamentLoader";

export default function ResultsView({
    id,
    authEnabled,
    spotifyExportEnabled,
}: {
    id: string;
    authEnabled: boolean;
    spotifyExportEnabled: boolean;
}) {
    const router = useRouter();
    const { tournament, resolved, sync } = useTournamentLoader(id, authEnabled);
    const activeAudioRef = useRef<HTMLAudioElement | null>(null);

    const derived = useMemo(() => (tournament ? derive(tournament) : null), [tournament]);

    // Results only make sense once a champion has actually been decided --
    // an in-progress tournament belongs back on the matchup screen.
    useEffect(() => {
        if (derived && derived.status !== "complete") router.replace(`/t/${id}`);
    }, [derived, id, router]);

    if (!resolved) {
        return (
            <div className="mx-auto max-w-3xl px-4 py-16 text-center text-fg-muted sm:px-6">
                Loading results…
            </div>
        );
    }

    if (!tournament || !derived || derived.status !== "complete") {
        return (
            <div className="mx-auto max-w-lg px-4 py-16 text-center sm:px-6">
                <h1 className="mb-2 text-xl font-bold">Results not found</h1>
                <p className="mb-6 text-sm text-fg-muted">
                    This link doesn&apos;t match a finished tournament on this device
                    {authEnabled ? " or your saved history" : ""}.
                </p>
                <Link href="/new" className="btn-primary">
                    Start a new tournament
                </Link>
            </div>
        );
    }

    const songById = new Map(tournament.songs.map((s) => [s.id, s]));
    const ranked = derived.standings.map((s) => {
        const song = songById.get(s.songId)!;
        return { title: song.title, artist: song.artist, spotifyUri: song.spotifyUri };
    });

    return (
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
            {sync}

            <header className="mb-6">
                <h1 className="text-xl font-bold sm:text-2xl">{tournament.name}</h1>
                <p className="mt-1 text-sm text-fg-muted">
                    {tournament.songs.length} songs · {tournament.votes.length} matchups played
                </p>
            </header>

            <div className="mb-6">
                <ExportPanel
                    tournamentName={tournament.name}
                    ranked={ranked}
                    spotifyExportEnabled={spotifyExportEnabled}
                />
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
                                            {recordLabel(standing)} · {(standing.omw * 100).toFixed(0)}% OMW
                                        </p>
                                    </div>
                                </div>

                                <div className="sm:ml-auto sm:w-56">
                                    <ClipPlayer
                                        previewUrl={song.previewUrl}
                                        previewSeconds={song.previewSeconds}
                                        previewNote={song.previewNote}
                                        clipSeconds={tournament.clipSeconds}
                                        activeAudioRef={activeAudioRef}
                                        label={song.title}
                                    />
                                </div>
                            </div>
                        </li>
                    );
                })}
            </ol>

            <div className="mt-8 text-center">
                <Link href="/new" className="btn-secondary">
                    Start another tournament
                </Link>
            </div>
        </div>
    );
}
