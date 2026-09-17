"use client";

import { useState } from "react";
import Link from "next/link";
import type { TournamentSummary, TopCutEntry } from "@/lib/queries";
import { looksComplete } from "@/lib/tournamentEngine";
import VisibilityToggle from "./VisibilityToggle";

/** What the server worked out about one ranking; see getTopCuts in lib/queries.ts. */
export interface RankingDetail {
    complete: boolean;
    top: TopCutEntry[];
}

/**
 * Everything you have ranked, split by whether it is finished.
 *
 * Data arrives as props rather than being fetched from here. The page above
 * is a server component that has already had to query for the podiums (which
 * cannot be computed without replaying vote logs -- see getTopCuts), so
 * fetching the summaries a second time from the client would be a round trip
 * to learn something the server already knew, and a flash of "Loading..." for
 * no reason. The optimistic updates below still keep delete and restore
 * instant; only the initial read moved.
 */
export default function MyRankings({
    initial,
    initialDeleted,
    details,
}: {
    initial: TournamentSummary[];
    initialDeleted: TournamentSummary[];
    /** Keyed by tournament id. Absent for anything the server didn't derive. */
    details: Record<string, RankingDetail>;
}) {
    const [tournaments, setTournaments] = useState<TournamentSummary[]>(initial);
    const [deleted, setDeleted] = useState<TournamentSummary[]>(initialDeleted);
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

    /** Moves a ranking to "recently deleted" -- reversible, and shown as such. */
    async function handleDelete(id: string) {
        setBusyId(id);
        try {
            const res = await fetch(`/api/tournaments/${id}`, { method: "DELETE" });
            if (res.ok) {
                const moved = tournaments.find((t) => t.id === id);
                setTournaments((prev) => prev.filter((t) => t.id !== id));
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
                if (back) setTournaments((prev) => [{ ...back, deleted_at: null }, ...prev]);
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

    /**
     * Finished or not.
     *
     * The server's derived answer wins where there is one, because it replayed
     * the actual vote log. `looksComplete` is the fallback for anything it
     * didn't derive -- a ranking just restored from the deleted list, most
     * obviously, which wasn't in the set the page asked about.
     */
    const isComplete = (t: TournamentSummary) => details[t.id]?.complete ?? looksComplete(t);
    const inProgress = tournaments.filter((t) => !isComplete(t));
    const finished = tournaments.filter(isComplete);

    function Row({ t, complete }: { t: TournamentSummary; complete: boolean }) {
        const top = details[t.id]?.top ?? [];
        return (
            <li className="card p-4">
                <div className="flex items-center gap-3">
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
                            <VisibilityToggle tournamentId={t.id} initial={t.visibility ?? "private"} compact />
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
                </div>

                {/* The podium, which is the actual answer to "what was this
                    ranking?" -- a name and a vote count are filing-cabinet
                    details, and you would have to open the thing to learn
                    what it decided. Three, because that is what anybody
                    means by the top of a list, and it fits one line on a
                    phone. */}
                {top.length > 0 && (
                    <ol className="mt-3 space-y-1 border-t border-border pt-3">
                        {top.map((entry) => (
                            <li key={entry.rank} className="flex items-baseline gap-2 text-xs">
                                <span className="w-4 shrink-0 text-center text-fg-muted">
                                    {entry.rank === 1 ? "👑" : entry.rank}
                                </span>
                                <span className="truncate font-medium text-fg">{entry.title}</span>
                                <span className="truncate text-fg-muted">{entry.artist || "Unknown artist"}</span>
                            </li>
                        ))}
                    </ol>
                )}
            </li>
        );
    }

    return (
        <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
            <h1 className="mb-6 text-xl font-bold sm:text-2xl">My Rankings</h1>

            {tournaments.length === 0 && (
                <div className="card p-6 text-center">
                    <p className="mb-4 text-sm text-fg-muted">No saved rankings yet.</p>
                    <Link href="/new" className="btn-primary">
                        Start one
                    </Link>
                </div>
            )}

            {/* In progress comes first: it is the section with something to
                do in it, and the one thing you are most likely here for is
                the ranking you were halfway through. */}
            {inProgress.length > 0 && (
                <section className="mb-10">
                    <h2 className="mb-3 text-lg font-semibold">
                        In progress{" "}
                        <span className="font-normal text-fg-muted">({inProgress.length})</span>
                    </h2>
                    <ul className="space-y-2">
                        {inProgress.map((t) => (
                            <Row key={t.id} t={t} complete={false} />
                        ))}
                    </ul>
                </section>
            )}

            {finished.length > 0 && (
                <section>
                    <h2 className="mb-3 text-lg font-semibold">
                        Finished <span className="font-normal text-fg-muted">({finished.length})</span>
                    </h2>
                    <ul className="space-y-2">
                        {finished.map((t) => (
                            <Row key={t.id} t={t} complete />
                        ))}
                    </ul>
                </section>
            )}

            {deleted.length > 0 && (
                <section className="mt-10">
                    <h2 className="text-lg font-semibold">Recently deleted</h2>
                    <p className="mb-3 text-sm text-fg-muted">
                        Deleted rankings are kept here so you can get them back. Restoring one returns
                        it exactly as it was — every vote, and whether it was public.{" "}
                        <strong className="text-fg">Delete forever</strong> is the irreversible one:
                        there is no backup to restore from afterwards.
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
                                            title="This cannot be undone. There is no backup to restore from."
                                        >
                                            {busyId === t.id ? "…" : "Yes, permanently"}
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
                                    // Spelled out rather than an "x". A bare
                                    // glyph is what made the first delete
                                    // dangerous -- it reads as "dismiss this
                                    // row" right up until it isn't -- and this
                                    // is the one button here with nothing
                                    // behind it. The words are the warning.
                                    <button
                                        type="button"
                                        onClick={() => setPurgingId(t.id)}
                                        className="btn-ghost shrink-0 !px-2 !py-1.5 text-xs text-danger"
                                        aria-label={`Permanently delete ${t.name}`}
                                    >
                                        Delete forever…
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
