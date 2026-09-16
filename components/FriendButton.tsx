"use client";

import { useState } from "react";

/**
 * Add or remove a friend, on someone's profile.
 *
 * Friendship here is one-way and gates nothing — see the `friends` table in
 * lib/db/schema.sql. The button says "Follow"/"Following" rather than "Add
 * friend"/"Friends" for exactly that reason: nobody is asked to accept, and a
 * button promising mutual friendship when the other person is never consulted
 * would be describing something the app doesn't do.
 */
export default function FriendButton({
    personId,
    personName,
    initiallyFriend,
}: {
    personId: number;
    personName: string;
    initiallyFriend: boolean;
}) {
    const [friend, setFriend] = useState(initiallyFriend);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function toggle() {
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
            const res = await fetch("/api/friends", {
                method: friend ? "DELETE" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ friendId: personId }),
            });
            const body = (await res.json().catch(() => null)) as
                | { friend?: boolean; error?: string }
                | null;
            if (!res.ok) {
                setError(body?.error ?? "Couldn't do that.");
                return;
            }
            setFriend(Boolean(body?.friend));
        } catch {
            setError("Couldn't reach the server.");
        } finally {
            setBusy(false);
        }
    }

    return (
        <div>
            <button
                type="button"
                onClick={toggle}
                disabled={busy}
                aria-pressed={friend}
                className={friend ? "btn-secondary" : "btn-primary"}
            >
                {busy ? "…" : friend ? `✓ Following ${personName}` : `+ Follow ${personName}`}
            </button>
            {error && <p className="mt-2 text-sm text-danger">{error}</p>}
            <p className="mt-2 text-xs text-fg-muted">
                {friend
                    ? "Their public rankings show at the top of Browse. They aren't notified, and this doesn't give either of you access to anything private."
                    : "Following puts someone's public rankings at the top of your Browse page. No request is sent — they aren't notified."}
            </p>
        </div>
    );
}
