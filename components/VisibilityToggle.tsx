"use client";

import { useState } from "react";
import type { Visibility } from "@/lib/queries";

/**
 * "Who can see this ranking" — the public/private switch, on the results
 * screen and in the history list.
 *
 * Optimistic, then corrected: the label flips immediately because the whole
 * point is a switch that feels like a switch, and reverts with an error if the
 * server disagrees. The risk of optimism here is low and bounded in the right
 * direction — the worst case is the UI briefly claiming something is public
 * when the write failed, which the revert corrects within one round trip, and
 * the row itself is only ever changed by the server's own scoped UPDATE.
 */
export default function VisibilityToggle({
    tournamentId,
    initial,
    compact = false,
}: {
    tournamentId: string;
    initial: Visibility;
    compact?: boolean;
}) {
    const [visibility, setVisibility] = useState<Visibility>(initial);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const isPublic = visibility === "public";

    async function toggle() {
        if (busy) return;
        const next: Visibility = isPublic ? "private" : "public";
        const previous = visibility;
        setVisibility(next);
        setBusy(true);
        setError(null);
        try {
            const res = await fetch(`/api/tournaments/${tournamentId}/visibility`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ visibility: next }),
            });
            if (!res.ok) {
                const body = (await res.json().catch(() => null)) as { error?: string } | null;
                setVisibility(previous);
                setError(body?.error ?? "Couldn't change that.");
            }
        } catch {
            setVisibility(previous);
            setError("Couldn't reach the server.");
        } finally {
            setBusy(false);
        }
    }

    if (compact) {
        return (
            <button
                type="button"
                onClick={toggle}
                disabled={busy}
                aria-pressed={isPublic}
                title={
                    isPublic
                        ? "Public — anyone can see this ranking. Click to make it private."
                        : "Private — only you can see this. Click to make it public."
                }
                className={`rounded-full border px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                    isPublic
                        ? "border-accent/40 bg-accent/10 text-accent"
                        : "border-border text-fg-muted hover:bg-bg-soft-2"
                }`}
            >
                {isPublic ? "🌐 Public" : "🔒 Private"}
            </button>
        );
    }

    return (
        <div className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <p className="text-sm font-semibold">
                        {isPublic ? "🌐 Public" : "🔒 Private"}
                    </p>
                    <p className="mt-0.5 text-sm text-fg-muted">
                        {isPublic
                            ? "Anyone can find this on Browse, copy the song list, and compare their ranking with yours."
                            : "Only you can see this. Nothing about it appears anywhere else on the site."}
                    </p>
                </div>
                <button type="button" onClick={toggle} disabled={busy} className="btn-secondary shrink-0">
                    {busy ? "Saving…" : isPublic ? "Make private" : "Make public"}
                </button>
            </div>
            {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        </div>
    );
}
