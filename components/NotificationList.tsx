"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { NotificationRow } from "@/lib/notifications";
import { profilePath } from "@/lib/username";

/**
 * The notices themselves, on /notifications.
 *
 * Everything is marked read on arrival, because arriving IS reading them --
 * there is no separate "open" step to hang it off, and a badge that survives
 * looking at the page would just be wrong. The rows keep their unread styling
 * for this render so the visit still shows what was new.
 */
export default function NotificationList() {
    const [rows, setRows] = useState<NotificationRow[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch("/api/notifications");
                if (!res.ok) throw new Error("load failed");
                const body = (await res.json()) as { notifications?: NotificationRow[] };
                if (cancelled) return;
                setRows(body.notifications ?? []);
                // Fire-and-forget: a failure here means the badge lingers,
                // which is a far smaller problem than blocking the list on it.
                if ((body.notifications ?? []).some((n) => n.read_at === null)) {
                    fetch("/api/notifications", { method: "POST" }).catch(() => {});
                }
            } catch {
                if (!cancelled) setError("Could not load your notifications.");
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    if (error) return <p className="text-sm text-danger">{error}</p>;
    if (rows === null) return <p className="text-sm text-fg-muted">Loading…</p>;

    if (rows.length === 0) {
        return (
            <p className="card p-6 text-sm text-fg-muted">
                Nothing yet. You&apos;ll hear from us when someone follows you, or uses one of your
                public lists to start their own ranking.
            </p>
        );
    }

    return (
        <ul className="space-y-2">
            {rows.map((n) => {
                const who = n.actor_name?.trim() || (n.actor_username ? `@${n.actor_username}` : "Someone");
                return (
                    <li
                        key={n.id}
                        className={`card p-4 ${n.read_at === null ? "border-accent/40 bg-accent/5" : ""}`}
                    >
                        <p className="text-sm">
                            <Link
                                href={profilePath({ id: n.actor_id, username: n.actor_username })}
                                className="font-semibold text-accent underline underline-offset-2"
                            >
                                {who}
                            </Link>{" "}
                            {n.kind === "follow" ? (
                                "followed you."
                            ) : (
                                <>
                                    used your list{" "}
                                    {n.tournament_id ? (
                                        <Link
                                            href={`/r/${n.tournament_id}`}
                                            className="font-medium text-fg underline underline-offset-2"
                                        >
                                            {n.tournament_name ?? "a ranking"}
                                        </Link>
                                    ) : (
                                        // The source was deleted since. The
                                        // notice is still true, so it stays --
                                        // just without a link to nowhere.
                                        <span className="font-medium text-fg">a ranking</span>
                                    )}{" "}
                                    to start their own.
                                </>
                            )}
                        </p>
                        <p className="mt-0.5 text-xs text-fg-muted">
                            {new Date(n.created_at).toLocaleString(undefined, {
                                month: "short",
                                day: "numeric",
                                hour: "numeric",
                                minute: "2-digit",
                            })}
                        </p>
                    </li>
                );
            })}
        </ul>
    );
}
