"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * "Rank these songs myself" on someone else's public ranking.
 *
 * Copies the song list only — never their votes — into a new private ranking
 * of your own, then goes straight there. See copyTournament in lib/queries.ts
 * for why the votes stay behind: starting from someone else's answers would
 * defeat the entire point of comparing afterwards.
 */
export default function CopyListButton({
    tournamentId,
    signedIn,
}: {
    tournamentId: string;
    signedIn: boolean;
}) {
    const router = useRouter();
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
            const res = await fetch(`/api/tournaments/${tournamentId}/copy`, { method: "POST" });
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
        <div>
            <button type="button" onClick={copy} disabled={busy} className="btn-primary">
                {busy ? "Copying…" : "Rank these songs myself"}
            </button>
            {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        </div>
    );
}
