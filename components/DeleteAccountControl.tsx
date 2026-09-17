"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";

/** What has to be typed to arm the button. */
const CONFIRM_WORD = "DELETE";

/**
 * Self-serve account deletion, on /my-rankings.
 *
 * Deliberately gated behind typing a word rather than a single click or a
 * browser `confirm()`. This is irreversible and it cascades: it takes every
 * saved ranking with it, which for someone hundreds of votes into a large list
 * is real work destroyed. A misclick should not be able to do that, and a
 * native confirm dialog is dismissed reflexively.
 *
 * Collapsed by default, so the destructive action is not sitting open on a page
 * people visit routinely to resume a ranking.
 */
export default function DeleteAccountControl() {
    const [open, setOpen] = useState(false);
    const [typed, setTyped] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const armed = typed.trim().toUpperCase() === CONFIRM_WORD;

    async function remove() {
        if (!armed || busy) return;
        setBusy(true);
        setError(null);
        try {
            const res = await fetch("/api/account", { method: "DELETE" });
            if (!res.ok) {
                const body = (await res.json().catch(() => null)) as { error?: string } | null;
                setError(body?.error ?? "Could not delete your account. Please try again.");
                setBusy(false);
                return;
            }
            // Sign out only after the delete succeeds. The session is a JWT, so
            // the cookie would otherwise keep presenting a user id that no
            // longer exists -- every subsequent request would be authenticated
            // as a deleted account. Doing it in the other order would be worse
            // still: a failed delete would leave someone signed out believing
            // their data was gone when it was not.
            await signOut({ redirectTo: "/" });
        } catch {
            setError("Could not reach the server. Nothing was deleted.");
            setBusy(false);
        }
    }

    if (!open) {
        return (
            <div className="mt-12 border-t border-border pt-6">
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    className="text-sm text-fg-muted underline underline-offset-2 hover:text-danger"
                >
                    Delete my account
                </button>
            </div>
        );
    }

    return (
        <div className="mt-12 rounded-lg border border-danger/40 bg-danger/5 p-4">
            <h2 className="mb-1 text-sm font-semibold text-fg">Delete your account</h2>
            <p className="mb-3 text-sm leading-relaxed text-fg-muted">
                This removes your account and <strong className="text-fg">every ranking you have
                saved</strong>, including any still in progress. It cannot be undone, and we keep no
                copy to restore from.
            </p>
            <label className="mb-3 block">
                <span className="mb-1 block text-xs font-medium text-fg-muted">
                    Type {CONFIRM_WORD} to confirm
                </span>
                <input
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    className="input"
                    autoComplete="off"
                    aria-label={`Type ${CONFIRM_WORD} to confirm account deletion`}
                />
            </label>
            {error && <p className="mb-3 text-sm text-danger">{error}</p>}
            <div className="flex flex-wrap gap-2">
                <button
                    type="button"
                    onClick={remove}
                    disabled={!armed || busy}
                    className="btn-primary !bg-danger !text-danger-fg disabled:opacity-40"
                >
                    {busy ? "Deleting…" : "Delete account and all rankings"}
                </button>
                <button
                    type="button"
                    onClick={() => {
                        setOpen(false);
                        setTyped("");
                        setError(null);
                    }}
                    disabled={busy}
                    className="btn-ghost"
                >
                    Cancel
                </button>
            </div>
        </div>
    );
}
