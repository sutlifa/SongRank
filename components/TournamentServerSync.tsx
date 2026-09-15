"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import type { Tournament } from "@/lib/types";

/**
 * The signed-in half of tournament persistence: renders nothing, just syncs.
 *
 * Only ever mounted from inside `{authEnabled && <TournamentServerSync .../>}`
 * (see components/Providers.tsx's header for why that gating exists), so
 * `useSession()` below can assume a `SessionProvider` is always present.
 *
 * Two jobs, both best-effort and silent on failure -- a signed-out or
 * offline user's tournament is already safe in localStorage (see
 * TournamentPlayer), so nothing here is load-bearing for the tournament to
 * work, only for it to *also* show up in /history and follow the user to
 * another device:
 *
 *   1. On first mount, if there's no local copy yet, try to fetch one from
 *      the server (the user opened a /t/[id] link on a new device).
 *   2. On every change to `tournament` afterward, PUT the current state to
 *      the server, debounced so a burst of undo/redo clicks doesn't fire one
 *      request per click.
 */
export default function TournamentServerSync({
    id,
    tournament,
    onServerResolved,
}: {
    id: string;
    tournament: Tournament | null;
    /** Called exactly once, with the tournament to hydrate from (or null if there isn't one). */
    onServerResolved: (remote: Tournament | null) => void;
}) {
    const { data: session, status } = useSession();
    const resolvedRef = useRef(false);
    const savedVoteCountRef = useRef<number | null>(null);

    // Job 1: resolve a starting tournament, once, as soon as we know whether
    // there's a session.
    useEffect(() => {
        if (status === "loading" || resolvedRef.current) return;
        resolvedRef.current = true;

        if (tournament) {
            // Already have a local copy -- nothing to fetch, and it counts as
            // "resolved" as far as the loading state goes.
            savedVoteCountRef.current = tournament.votes.length;
            onServerResolved(tournament);
            return;
        }
        if (!session?.user) {
            onServerResolved(null);
            return;
        }

        fetch(`/api/tournaments/${id}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((data: { tournament?: Tournament } | null) => {
                onServerResolved(data?.tournament ?? null);
            })
            .catch(() => onServerResolved(null));
        // onServerResolved is a stable setState wrapper from the parent; the
        // resolvedRef guard is what actually prevents this from re-running.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status, session, id]);

    // Job 2: debounced autosave on every subsequent change.
    useEffect(() => {
        if (!session?.user || !tournament) return;
        if (savedVoteCountRef.current === tournament.votes.length) return;

        const timer = setTimeout(() => {
            fetch(`/api/tournaments/${id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: tournament.name,
                    clipSeconds: tournament.clipSeconds,
                    songs: tournament.songs,
                    votes: tournament.votes,
                }),
            })
                .then(() => {
                    savedVoteCountRef.current = tournament.votes.length;
                })
                .catch(() => {
                    // Best-effort: the vote is already safe in localStorage: a
                    // failed autosave just means this device's history entry
                    // is stale until the next successful save.
                });
        }, 500);

        return () => clearTimeout(timer);
    }, [session, tournament, id]);

    return null;
}
