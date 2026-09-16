"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { TournamentSummary } from "@/lib/queries";
import { plannedRounds, matchupsInRound } from "@/lib/swiss";
import { estimateMatchups } from "@/lib/ranking";
import VisibilityToggle from "./VisibilityToggle";

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
    const [deleted, setDeleted] = useState<TournamentSummary[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    /**
     * Which row is currently asking "are you sure?".
     *
     * A ranking can be well over a thousand decisions of someone's actual
     * attention. This used to be a bare "x" that fired an irreversible DELETE
     * on a single click, sitting a few pixels from the button you press to
     * open the thing -- which is exactly how someone loses sixteen hundred
     * votes to one misclick. Deleting is now two deliberate clicks AND
     * recoverable afterwards; either alone would still be too thin for
     * something with no undo.
     */
    const [confirmingId, setConfirmingId] = useState<string | null>(null);
    /** Same, for the genuinely irreversible "delete forever". */
    const [purgingId, setPurgingId] = useState<string | null>(null);

    useEffect(() => {
        Promise.all([
            fetch("/api/tournaments").then((res) => (res.ok ? res.json() : Promise.reject())),
            fetch("/api/tournaments?deleted=1").then((res) => (res.ok ? res.json() : { tournaments: [] })),
        ])
            .then(([live, gone]) => {
                setTournaments(live.tournaments);
                setDeleted(gone.tournaments ?? []);
            })
            .catch(() => setError("Could not load your history"));
    }, []);

    /** Moves a ranking to "recently deleted" -- reversible, and shown as such. */
    async function handleDelete(id: string) {
        setBusyId(id);
        try {
            const res = await fetch(`/api/tournaments/${id}`, { method: "DELETE" });
            if (res.ok) {
                const moved = tournaments?.find((t) => t.id === id);
                setTournaments((prev) => prev?.filter((t) => t.id !== id) ?? prev);
                // Put it straight into the deleted list rather than refetching,
                // so the row visibly moves from one section to the other and
                // "it's still here, I can get it back" is immediate.
                if (moved) setDeleted((prev) => [{ ...moved, deleted_at: new Date().toISOString() }, ...prev]);
            }
        } finally {
            setBusyId(null);
            setConfirmingId(null);
        }
    }

    async function handleRestore(id: string) {
        setBusyId(id);
        try {
            const res = await fetch(`/api/tournaments/${id}`, { method: "PATCH" });
            if (res.ok) {
                const back = deleted.find((t) => t.id === id);
                setDeleted((prev) => prev.filter((t) => t.id !== id));
                if (back) setTournaments((prev) => [{ ...back, deleted_at: null }, ...(prev ?? [])]);
            }
        } finally {
            setBusyId(null);
        }
    }

    async function handlePurge(id: string) {
        setBusyId(id);
        try {
            const res = await fetch(`/api/tournaments/${id}?permanent=1`, { method: "DELETE" });
            if (res.ok) setDeleted((prev) => prev.filter((t) => t.id !== id));
        } finally {
            setBusyId(null);
            setPurgingId(null);
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
                                <div className="mt-1.5">
                                    {/* Every saved ranking, not just finished
                                        ones: someone may well want a ranking
                                        visible while it is still being played,
                                        and hiding the control until the end
                                        would make "public" feel like a property
                                        of results rather than of the ranking. */}
                                    <VisibilityToggle
                                        tournamentId={t.id}
                                        initial={t.visibility ?? "private"}
                                        compact
                                    />
                                </div>
                            </div>
                            <Link href={`/t/${t.id}`} className="btn-secondary shrink-0 !px-3 !py-1.5 text-xs">
                                {complete ? "View results" : "Resume"}
                            </Link>
                            {confirmingId === t.id ? (
                                <span className="flex shrink-0 items-center gap-1">
                                    <button
                                        type="button"
                                        onClick={() => handleDelete(t.id)}
                                        disabled={busyId === t.id}
                                        className="btn-secondary shrink-0 !bg-danger !px-2 !py-1.5 text-xs !text-danger-fg"
                                    >
                                        {busyId === t.id ? "…" : "Delete"}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setConfirmingId(null)}
                                        className="btn-ghost shrink-0 !px-2 !py-1.5 text-xs"
                                    >
                                        Cancel
                                    </button>
                                </span>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => setConfirmingId(t.id)}
                                    className="btn-ghost shrink-0 !px-2 !py-1.5 text-xs text-danger"
                                    aria-label={`Delete ${t.name}`}
                                >
                                    ✕
                                </button>
                            )}
                        </li>
                    );
                })}
            </ul>

            {deleted.length > 0 && (
                <section className="mt-10">
                    <h2 className="text-lg font-semibold">Recently deleted</h2>
                    <p className="mb-3 text-sm text-fg-muted">
                        Deleted rankings are kept here so you can get them back. Restoring one returns
                        it exactly as it was — every vote, and whether it was public.
                    </p>
                    <ul className="space-y-2">
                        {deleted.map((t) => (
                            <li key={t.id} className="card flex items-center gap-3 border-dashed p-4">
                                <div className="min-w-0 flex-1">
                                    <p className="truncate font-medium text-fg-muted">{t.name}</p>
                                    <p className="text-xs text-fg-muted">
                                        {t.songs} songs · {t.votes} votes · deleted{" "}
                                        {t.deleted_at
                                            ? new Date(t.deleted_at).toLocaleString(undefined, {
                                                  month: "short",
                                                  day: "numeric",
                                                  hour: "numeric",
                                                  minute: "2-digit",
                                              })
                                            : "just now"}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => handleRestore(t.id)}
                                    disabled={busyId === t.id}
                                    className="btn-secondary shrink-0 !px-3 !py-1.5 text-xs"
                                >
                                    {busyId === t.id ? "…" : "Restore"}
                                </button>
                                {purgingId === t.id ? (
                                    <span className="flex shrink-0 items-center gap-1">
                                        <button
                                            type="button"
                                            onClick={() => handlePurge(t.id)}
                                            disabled={busyId === t.id}
                                            className="btn-secondary shrink-0 !bg-danger !px-2 !py-1.5 text-xs !text-danger-fg"
                                            title="This cannot be undone."
                                        >
                                            Delete forever
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setPurgingId(null)}
                                            className="btn-ghost shrink-0 !px-2 !py-1.5 text-xs"
                                        >
                                            Cancel
                                        </button>
                                    </span>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => setPurgingId(t.id)}
                                        className="btn-ghost shrink-0 !px-2 !py-1.5 text-xs text-danger"
                                        aria-label={`Permanently delete ${t.name}`}
                                    >
                                        ✕
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </div>
    );
}
