"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { TournamentSummary } from "@/lib/queries";

export default function HistoryList() {
    const [tournaments, setTournaments] = useState<TournamentSummary[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    useEffect(() => {
        fetch("/api/tournaments")
            .then((res) => (res.ok ? res.json() : Promise.reject()))
            .then((data) => setTournaments(data.tournaments))
            .catch(() => setError("Could not load your history"));
    }, []);

    async function handleDelete(id: string) {
        setDeletingId(id);
        try {
            const res = await fetch(`/api/tournaments/${id}`, { method: "DELETE" });
            if (res.ok) setTournaments((prev) => prev?.filter((t) => t.id !== id) ?? prev);
        } finally {
            setDeletingId(null);
        }
    }

    return (
        <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
            <h1 className="mb-6 text-xl font-bold sm:text-2xl">Your history</h1>

            {error && (
                <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                    {error}
                </p>
            )}
            {!error && tournaments === null && <p className="text-sm text-fg-muted">Loading…</p>}
            {tournaments?.length === 0 && (
                <div className="card p-6 text-center">
                    <p className="mb-4 text-sm text-fg-muted">No saved tournaments yet.</p>
                    <Link href="/new" className="btn-primary">
                        Start one
                    </Link>
                </div>
            )}

            <ul className="space-y-2">
                {tournaments?.map((t) => {
                    const complete = t.votes >= t.songs - 1 && t.songs > 1; // a quick "looks finished" hint only
                    return (
                        <li key={t.id} className="card flex items-center gap-3 p-4">
                            <div className="min-w-0 flex-1">
                                <p className="truncate font-medium">{t.name}</p>
                                <p className="text-xs text-fg-muted">
                                    {t.songs} songs · {t.votes} votes ·{" "}
                                    {new Date(t.updated_at).toLocaleDateString(undefined, {
                                        month: "short",
                                        day: "numeric",
                                        year: "numeric",
                                    })}
                                </p>
                            </div>
                            <Link href={`/t/${t.id}`} className="btn-secondary shrink-0 !px-3 !py-1.5 text-xs">
                                {complete ? "View results" : "Resume"}
                            </Link>
                            <button
                                type="button"
                                onClick={() => handleDelete(t.id)}
                                disabled={deletingId === t.id}
                                className="btn-ghost shrink-0 !px-2 !py-1.5 text-xs text-danger"
                                aria-label={`Delete ${t.name}`}
                            >
                                {deletingId === t.id ? "…" : "✕"}
                            </button>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
