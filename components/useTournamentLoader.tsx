"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Tournament } from "@/lib/types";
import { loadLocalTournament, saveLocalTournament } from "@/lib/localTournaments";
import TournamentServerSync from "./TournamentServerSync";

/**
 * Shared loading/persistence logic behind both /t/[id] (play) and
 * /t/[id]/results: try localStorage first, fall back to a signed-in user's
 * server copy, and keep both in sync afterward. See
 * components/TournamentServerSync.tsx for the actual sync mechanics -- this
 * hook just wires it up and owns the resulting state.
 *
 * Returns a `sync` node the caller must render (even though it renders
 * nothing itself) so its effects actually run; a hook can't mount a
 * component on the caller's behalf without the caller putting it in the tree.
 *
 * Both `tournament` and `resolved` start out null/false on *every* render,
 * server or client, and are only ever populated from inside a `useEffect`.
 * That's deliberate, not a missed optimization: `loadLocalTournament` reads
 * `window.localStorage`, which doesn't exist during a server render, so
 * seeding state straight from it in a `useState` initializer (as this used
 * to do) gives the server a `null` tournament and the client's very first
 * render a real one -- two different trees for the same markup, which React
 * detects as a hydration mismatch and throws away the server-rendered DOM
 * to reconcile from scratch. Effects run only after hydration completes on
 * the client, so reading localStorage from inside one keeps both renders in
 * agreement: both start in the loading state below, and the real data
 * arrives as an ordinary post-mount update.
 */
export function useTournamentLoader(
    id: string,
    authEnabled: boolean
): {
    tournament: Tournament | null;
    resolved: boolean;
    updateTournament: (updater: (t: Tournament) => Tournament) => void;
    sync: ReactNode;
} {
    const [tournament, setTournament] = useState<Tournament | null>(null);
    const [resolved, setResolved] = useState(false);
    const checkedLocalRef = useRef(false);

    useEffect(() => {
        if (checkedLocalRef.current) return;
        checkedLocalRef.current = true;

        // Deferred a tick past the effect's own body -- see ExportPanel's and
        // TournamentPlayer's matching comments on this same pattern. The
        // localStorage read itself is synchronous, but acting on it (setting
        // state) is kept one step removed from the effect body proper.
        const timer = setTimeout(() => {
            const local = loadLocalTournament(id);
            if (local) setTournament(local);

            // With auth off there's no server copy to wait for either way --
            // whatever localStorage did or didn't have is the final answer.
            // With auth on, this is left false: TournamentServerSync's own
            // resolution (below) covers both "found it locally" and "had to
            // ask the server" and is what flips it to true in that case.
            if (!authEnabled) setResolved(true);
        }, 0);
        return () => clearTimeout(timer);
    }, [id, authEnabled]);

    const handleServerResolved = useCallback((remote: Tournament | null) => {
        setResolved(true);
        if (remote) {
            setTournament((prev) => prev ?? remote);
            saveLocalTournament(remote);
        }
    }, []);

    const updateTournament = useCallback((updater: (t: Tournament) => Tournament) => {
        setTournament((prev) => {
            if (!prev) return prev;
            const next = updater(prev);
            saveLocalTournament(next);
            return next;
        });
    }, []);

    const sync = authEnabled ? (
        <TournamentServerSync id={id} tournament={tournament} onServerResolved={handleServerResolved} />
    ) : null;

    return { tournament, resolved, updateTournament, sync };
}
