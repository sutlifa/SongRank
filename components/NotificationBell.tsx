"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";

/**
 * The unread count in the header.
 *
 * Asks for a count and nothing else (`?countOnly=1`), because that is all it
 * renders. It is deliberately quiet when there is nothing to say: no bell, no
 * zero badge, no empty affordance on a page nobody needs -- a notification
 * surface should be invisible until something has actually happened.
 *
 * Polling is on purpose rather than a socket: the events are a follow and a
 * copy, neither of which anyone needs within a second, and one small query a
 * minute costs less than keeping a connection open per visitor.
 */
const POLL_MS = 60_000;

export default function NotificationBell() {
    const { status } = useSession();
    const [unread, setUnread] = useState(0);

    useEffect(() => {
        if (status !== "authenticated") return;

        let cancelled = false;
        async function check() {
            try {
                const res = await fetch("/api/notifications?countOnly=1");
                if (!res.ok || cancelled) return;
                const body = (await res.json()) as { unread?: number };
                if (!cancelled) setUnread(typeof body.unread === "number" ? body.unread : 0);
            } catch {
                // Offline or a blip. Saying nothing is right: a badge is not
                // worth an error state.
            }
        }

        check();
        const timer = setInterval(check, POLL_MS);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [status]);

    if (status !== "authenticated" || unread === 0) return null;

    return (
        <Link
            href="/notifications"
            className="relative rounded-lg px-3 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-bg-soft-2 hover:text-fg"
            aria-label={`${unread} unread notification${unread === 1 ? "" : "s"}`}
        >
            🔔
            <span className="ml-1 rounded-full bg-accent px-1.5 py-0.5 text-xs font-bold text-accent-fg">
                {unread > 99 ? "99+" : unread}
            </span>
        </Link>
    );
}
