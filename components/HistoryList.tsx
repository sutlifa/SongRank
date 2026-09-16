"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { TournamentSummary } from "@/lib/queries";
import { plannedRounds, matchupsInRound } from "@/lib/swiss";
import { estimateMatchups } from "@/lib/ranking";

/**
 * A rough "looks finished" hint for the Resume/View results button label --
 * never load-bearing (a stale label just means the wrong button text; the
 * player and results pages both re-derive the real status from the vote log
 * the moment they load), so it's fine for this to be an estimate rather than
 * a stored, exactly-right status.
 *
 * The two engines need very different thresholds: Swiss finishes in roughly
 * `plannedRounds * matchupsInRound` votes, while an adaptive tournament's
 * main phase alone targets `~1.25 * n * log2(n)` at Thorough -- an order of
 * magnitude more for a large field. Using the Swiss estimate for both (as
 * this used to, back when Swiss was the only engine) would call a
 * barely-started adaptive tournament "finished" as soon as it reached
 * n - 1 votes.
 */
function looksComplete(t: TournamentSummary): boolean {
    if (t.songs <= 1) return true;
    if (t.format === "adaptive") {
        return t.votes >= estimateMatchups(t.songs, t.depth ?? "thorough");
    }
    return t.votes >= plannedRounds(t.songs) * matchupsInRound(t.songs);
}

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
                    <p className="mb-4 text-sm text-fg-muted">No saved rankings yet.</p>
                    <Link href="/new" className="btn-primary">
                        Start one
                    </Link>
                </div>
            )}

            <ul className="space-y-2">
                {tournaments?.map((t) => {
                    const complete = looksComplete(t);
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
