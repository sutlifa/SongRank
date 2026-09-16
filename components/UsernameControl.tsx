"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { checkUsername, normaliseUsername, USERNAME_MAX } from "@/lib/username";

/**
 * Pick or change your handle.
 *
 * Two presentations from one component: a prominent card when you have no
 * username yet (because without one nobody can find you, which is worth
 * saying once rather than leaving as a mystery), and a quiet inline editor
 * once you do.
 *
 * `checkUsername` runs here as well as on the server. Not as the rule -- the
 * route validates independently and is what actually decides -- but so that
 * "usernames can't start with an underscore" arrives as you type instead of
 * after a round trip. Uniqueness deliberately isn't checked here: only the
 * database can answer that correctly, and a "looks free!" that turns out to
 * be wrong a second later is worse than not guessing.
 */
export default function UsernameControl({
    current,
    suggestion,
}: {
    current: string | null;
    suggestion: string | null;
}) {
    const router = useRouter();
    const [value, setValue] = useState(current ?? suggestion ?? "");
    const [editing, setEditing] = useState(current === null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState<string | null>(current);

    const typed = normaliseUsername(value);
    const localProblem = typed.length > 0 ? checkUsername(typed) : null;
    const unchanged = saved !== null && typed === saved;

    async function submit(e: React.FormEvent) {
        e.preventDefault();
        if (busy) return;

        const problem = checkUsername(typed);
        if (problem) {
            setError(problem);
            return;
        }

        setBusy(true);
        setError(null);
        try {
            const res = await fetch("/api/account/username", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username: typed }),
            });
            const body = (await res.json().catch(() => null)) as
                | { username?: string; error?: string }
                | null;
            if (!res.ok || !body?.username) {
                setError(body?.error ?? "Could not save that username.");
                return;
            }
            setSaved(body.username);
            setValue(body.username);
            setEditing(false);
            // The handle appears in the people directory, on every profile
            // link and on public ranking cards, all of which are server
            // rendered -- so a refresh is what makes the change actually show
            // up rather than only in this one component's state.
            router.refresh();
        } catch {
            setError("Could not reach the server.");
        } finally {
            setBusy(false);
        }
    }

    if (!editing && saved) {
        return (
            <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm">
                    <span className="text-fg-muted">Your username:</span>{" "}
                    <span className="font-mono font-semibold text-fg">@{saved}</span>
                </p>
                <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="text-xs text-accent underline underline-offset-2"
                >
                    Change
                </button>
            </div>
        );
    }

    return (
        <form onSubmit={submit} className={saved ? "" : "rounded-lg border border-accent/30 bg-accent/10 p-4"}>
            {!saved && (
                <>
                    <p className="text-sm font-semibold text-accent">Pick a username</p>
                    <p className="mb-3 mt-1 text-sm text-fg-muted">
                        It&apos;s how friends find you, so you never have to give out your email
                        address. Letters, numbers and underscores, up to {USERNAME_MAX} characters.
                    </p>
                </>
            )}
            <div className="flex flex-wrap items-start gap-2">
                <label className="min-w-0 flex-1">
                    <span className="sr-only">Username</span>
                    <div className="flex items-center gap-1">
                        <span aria-hidden="true" className="font-mono text-fg-muted">
                            @
                        </span>
                        <input
                            value={value}
                            onChange={(e) => {
                                setValue(e.target.value);
                                setError(null);
                            }}
                            placeholder="yourname"
                            maxLength={USERNAME_MAX}
                            autoComplete="off"
                            autoCapitalize="none"
                            spellCheck={false}
                            className="input font-mono"
                        />
                    </div>
                </label>
                <button
                    type="submit"
                    disabled={busy || typed.length === 0 || localProblem !== null || unchanged}
                    className="btn-primary shrink-0 disabled:opacity-40"
                >
                    {busy ? "Saving…" : saved ? "Save" : "Claim it"}
                </button>
                {saved && (
                    <button
                        type="button"
                        onClick={() => {
                            setEditing(false);
                            setValue(saved);
                            setError(null);
                        }}
                        disabled={busy}
                        className="btn-ghost shrink-0"
                    >
                        Cancel
                    </button>
                )}
            </div>
            {(error ?? localProblem) && (
                <p className="mt-2 text-sm text-danger">{error ?? localProblem}</p>
            )}
        </form>
    );
}
