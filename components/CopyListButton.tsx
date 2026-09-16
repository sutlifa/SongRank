"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { estimateMatchups } from "@/lib/ranking";
import { DEFAULT_DEPTH, RANKING_DEPTHS, type RankingDepth } from "@/lib/types";

const DEPTH_LABELS: Record<RankingDepth, string> = {
    quick: "Quick",
    balanced: "Balanced",
    thorough: "Thorough",
};

/**
 * "Rank these songs myself" on someone else's public ranking.
 *
 * Copies the song list only -- never their votes -- into a new private ranking
 * of your own, then goes straight there.
 *
 * ## Why there is a depth choice here at all
 *
 * This used to be a single button that inherited the source ranking's depth
 * and dropped you on your first matchup. Two things were wrong with that.
 * Someone who picked Quick for a throwaway list silently imposed Quick on
 * everyone who ever copied it. And the copier -- who is about to spend
 * anywhere from thirty to several thousand decisions -- was never shown that
 * the choice existed, let alone asked. How thorough your own ranking is, is
 * yours to decide; it is not a property of the list you took.
 *
 * So the choice is made here, before anything is created, and it starts on the
 * app's own default rather than on whatever the other person happened to pick.
 */
export default function CopyListButton({
    tournamentId,
    songCount,
    signedIn,
}: {
    tournamentId: string;
    /** So the estimate under each depth is this list's real cost, not a guess. */
    songCount: number;
    signedIn: boolean;
}) {
    const router = useRouter();
    const [depth, setDepth] = useState<RankingDepth>(DEFAULT_DEPTH);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!signedIn) {
        return (
            <a
                href={`/signin?callbackUrl=${encodeURIComponent(`/r/${tournamentId}`)}`}
                className="btn-primary"
            >
                Sign in to rank these songs
            </a>
        );
    }

    async function copy() {
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
            const res = await fetch(`/api/tournaments/${tournamentId}/copy`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ depth }),
            });
            const body = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
            if (!res.ok || !body?.id) {
                setError(body?.error ?? "Couldn't copy that list.");
                setBusy(false);
                return;
            }
            // Straight into the new ranking. Left busy on purpose: the
            // navigation is the completion, and re-enabling the button first
            // invites a second copy in the gap.
            router.push(`/t/${body.id}`);
        } catch {
            setError("Couldn't reach the server.");
            setBusy(false);
        }
    }

    return (
        <div className="w-full">
            <p className="mb-2 text-sm font-semibold">Rank these {songCount} songs yourself</p>
            <p className="mb-3 text-sm text-fg-muted">
                You get your own copy of the song list. Their picks aren&apos;t copied, nothing you
                do can change their ranking, and yours starts private.
            </p>

            <fieldset className="mb-3">
                <legend className="mb-2 text-xs font-medium text-fg-muted">
                    How thorough should yours be? Your choice — not theirs.
                </legend>
                <div className="grid gap-2 sm:grid-cols-3">
                    {RANKING_DEPTHS.map((d) => (
                        <button
                            key={d}
                            type="button"
                            onClick={() => setDepth(d)}
                            aria-pressed={depth === d}
                            className={`rounded-lg border p-3 text-left transition-colors ${
                                depth === d ? "border-accent bg-accent/10" : "border-border hover:bg-bg-soft-2"
                            }`}
                        >
                            <span className="block text-sm font-semibold">{DEPTH_LABELS[d]}</span>
                            <span className="mt-0.5 block text-xs text-fg-muted">
                                ~{estimateMatchups(songCount, d).toLocaleString()} matchups
                            </span>
                        </button>
                    ))}
                </div>
            </fieldset>

            <button type="button" onClick={copy} disabled={busy} className="btn-primary">
                {busy ? "Copying…" : "Start my ranking"}
            </button>
            {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        </div>
    );
}
