"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MAX_SONGS, describePlan } from "@/lib/swiss";
import { CLIP_SECONDS, type ClipSeconds, type Song, type Tournament } from "@/lib/types";
import { saveLocalTournament } from "@/lib/localTournaments";
import PasteImportTab from "./PasteImportTab";
import SearchImportTab from "./SearchImportTab";
import SpotifyImportTab from "./SpotifyImportTab";
import ReviewTable from "./ReviewTable";

/**
 * A song mid-import, before it's a real `Song`. The three import tabs
 * (paste/search/Spotify) all produce these; the review table lets a human
 * edit them; `startTournament` below turns the finished list into `Song[]`.
 *
 * `resolved` is `null` for anything that still needs an iTunes lookup
 * (pasted or Spotify-imported songs) and already-filled for anything search
 * added directly (it came from iTunes already). Keeping this distinction is
 * what lets `startTournament` skip re-resolving songs that don't need it.
 */
export interface DraftSong {
    id: string;
    title: string;
    artist: string;
    ambiguous: boolean;
    resolved: { artworkUrl: string | null; previewUrl: string | null; previewSeconds: number | null } | null;
    spotifyUri: string | null;
}

type Tab = "paste" | "search" | "spotify";

/** Resolves a batch of draft songs against iTunes with bounded concurrency. */
async function resolvePreviews(
    drafts: DraftSong[],
    onProgress: (done: number, total: number) => void
): Promise<DraftSong[]> {
    const toResolve = drafts.filter((d) => d.resolved === null);
    if (toResolve.length === 0) return drafts;

    const resolvedById = new Map<string, DraftSong["resolved"]>();
    let done = 0;
    const CONCURRENCY = 6;
    let cursor = 0;

    async function worker() {
        for (;;) {
            const index = cursor++;
            if (index >= toResolve.length) return;
            const draft = toResolve[index];
            try {
                const res = await fetch("/api/songs/resolve", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ title: draft.title, artist: draft.artist }),
                });
                const data = await res.json();
                resolvedById.set(draft.id, data.preview ?? null);
            } catch {
                resolvedById.set(draft.id, null);
            }
            done += 1;
            onProgress(done, toResolve.length);
        }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, toResolve.length) }, worker));

    return drafts.map((d) => (resolvedById.has(d.id) ? { ...d, resolved: resolvedById.get(d.id)! } : d));
}

export default function NewTournament({ spotifyImportEnabled }: { spotifyImportEnabled: boolean }) {
    const router = useRouter();
    const [tab, setTab] = useState<Tab>("paste");
    const [songs, setSongs] = useState<DraftSong[]>([]);
    const [name, setName] = useState("");
    const [clipSeconds, setClipSeconds] = useState<ClipSeconds>(15);
    const [starting, setStarting] = useState<{ done: number; total: number } | null>(null);
    const [error, setError] = useState<string | null>(null);

    function addSongs(incoming: DraftSong[]) {
        setSongs((prev) => {
            const seen = new Set(prev.map((s) => `${s.title.toLowerCase()}|${s.artist.toLowerCase()}`));
            const room = MAX_SONGS - prev.length;
            const accepted: DraftSong[] = [];
            for (const song of incoming) {
                if (accepted.length >= room) break;
                const key = `${song.title.toLowerCase()}|${song.artist.toLowerCase()}`;
                if (seen.has(key)) continue;
                seen.add(key);
                accepted.push(song);
            }
            return [...prev, ...accepted];
        });
    }

    function updateSong(id: string, patch: Partial<Pick<DraftSong, "title" | "artist">>) {
        setSongs((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch, ambiguous: false } : s)));
    }

    function removeSong(id: string) {
        setSongs((prev) => prev.filter((s) => s.id !== id));
    }

    async function startTournament() {
        setError(null);
        const trimmedName = name.trim() || "My songs";
        const cleanSongs = songs.filter((s) => s.title.trim());
        if (cleanSongs.length < 2) {
            setError("Add at least 2 songs to start a tournament.");
            return;
        }

        setStarting({ done: 0, total: cleanSongs.length });
        const resolved = await resolvePreviews(cleanSongs, (done, total) => setStarting({ done, total }));

        const finalSongs: Song[] = resolved.map((d) => ({
            id: crypto.randomUUID(),
            title: d.title.trim(),
            artist: d.artist.trim(),
            artworkUrl: d.resolved?.artworkUrl ?? null,
            previewUrl: d.resolved?.previewUrl ?? null,
            previewSeconds: d.resolved?.previewSeconds ?? null,
            spotifyUri: d.spotifyUri,
            previewNote: d.resolved?.previewUrl ? null : "No preview available for this track.",
        }));

        const now = new Date().toISOString();
        const tournament: Tournament = {
            id: crypto.randomUUID(),
            name: trimmedName,
            createdAt: now,
            updatedAt: now,
            clipSeconds,
            songs: finalSongs,
            votes: [],
        };

        saveLocalTournament(tournament);

        // Best-effort head start on saved history: if nobody's signed in, or
        // there's no database configured, the server route politely 401s/
        // 503s this and localStorage is already the source of truth either
        // way -- see lib/auth-guard.ts and TournamentServerSync, which takes
        // over autosaving from here once the player screen mounts.
        fetch("/api/tournaments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                id: tournament.id,
                name: tournament.name,
                clipSeconds: tournament.clipSeconds,
                songs: tournament.songs,
                votes: tournament.votes,
            }),
        }).catch(() => {});

        router.push(`/t/${tournament.id}`);
    }

    return (
        <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
            <h1 className="mb-1 text-xl font-bold sm:text-2xl">Build your tournament</h1>
            <p className="mb-6 text-sm text-fg-muted">
                Add songs from any combination of the tabs below, then review and start.
            </p>

            <div className="card p-4 sm:p-5">
                <div className="mb-4 flex gap-1 border-b border-border pb-3">
                    {(
                        [
                            ["paste", "Paste a list"],
                            ["search", "Search"],
                            ["spotify", "Spotify playlist"],
                        ] as [Tab, string][]
                    ).map(([value, label]) => (
                        <button
                            key={value}
                            type="button"
                            onClick={() => setTab(value)}
                            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                                tab === value ? "bg-bg-soft-2 text-fg" : "text-fg-muted hover:bg-bg-soft-2"
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {tab === "paste" && <PasteImportTab onAdd={addSongs} />}
                {tab === "search" && <SearchImportTab onAdd={addSongs} />}
                {tab === "spotify" && <SpotifyImportTab enabled={spotifyImportEnabled} onAdd={addSongs} />}
            </div>

            <div className="mt-6">
                <div className="mb-3 flex items-center justify-between">
                    <h2 className="font-semibold">
                        Review ({songs.length}/{MAX_SONGS})
                    </h2>
                </div>
                <ReviewTable songs={songs} onChange={updateSong} onRemove={removeSong} />
            </div>

            <div className="card mt-6 space-y-4 p-4 sm:p-5">
                <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                        <span className="mb-1 block text-xs font-medium text-fg-muted">Tournament name</span>
                        <input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="My songs"
                            maxLength={120}
                            className="input"
                        />
                    </label>
                    <label className="block">
                        <span className="mb-1 block text-xs font-medium text-fg-muted">Clip length</span>
                        <select
                            value={clipSeconds}
                            onChange={(e) => setClipSeconds(Number(e.target.value) as ClipSeconds)}
                            className="input"
                        >
                            {CLIP_SECONDS.map((s) => (
                                <option key={s} value={s}>
                                    {s} seconds
                                </option>
                            ))}
                        </select>
                    </label>
                </div>

                <p className="text-sm text-fg-muted">{describePlan(songs.length)}</p>

                {error && (
                    <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                        {error}
                    </p>
                )}

                <button
                    type="button"
                    onClick={startTournament}
                    disabled={Boolean(starting)}
                    className="btn-primary w-full text-base"
                >
                    {starting ? `Finding clips… ${starting.done}/${starting.total}` : "Start tournament"}
                </button>
            </div>
        </div>
    );
}
