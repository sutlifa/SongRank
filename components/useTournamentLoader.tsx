"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Tournament } from "@/lib/types";
import { saveLocalTournament } from "@/lib/localTournaments";
import { getSessionTournament, setSessionTournament } from "@/lib/sessionCache";
import TournamentServerSync from "./TournamentServerSync";

/**
 * Shared loading/persistence logic behind both /t/[id] (play) and
 * /t/[id]/results: hand off an in-progress tournament within this tab (see
 * lib/sessionCache.ts), and -- **only for an actually signed-in user** --
 * additionally read/write localStorage and sync to the server. See
 * components/TournamentServerSync.tsx for the sync mechanics -- this hook
 * just wires it up and owns the resulting state.
 *
 * "Save and resume should only work on signed in users" (the user's own
 * product decision, see AGENT-TEAM.md and CLAUDE.md's Ranking engine
 * section) is why localStorage is no longer touched unconditionally here the
 * way it used to be: a guest's tournament now lives only in
 * lib/sessionCache.ts's in-memory map, which is not persistence -- it
 * doesn't survive a refresh, exactly as promised by the warning shown before
 * a signed-out user starts one (see NewTournament.tsx). Whether the current
 * user actually has a session isn't decided here, though: it's determined by
 * TournamentServerSync's own `useSession()` call (see that file's header for
 * why this hook can't call it directly), and reported back through
 * `onServerResolved`'s new `signedIn` argument -- `signedInRef` below is set
 * from that, once, before `resolved` ever flips true, so nothing can vote
 * before this hook knows which persistence tier applies.
 *
 * Returns a `sync` node the caller must render (even though it renders
 * nothing itself) so its effects actually run; a hook can't mount a
 * component on the caller's behalf without the caller putting it in the tree.
 *
 * Both `tournament` and `resolved` start out null/false on *every* render,
 * server or client, and are only ever populated from inside a `useEffect`.
 * That's deliberate, not a missed optimization: reading storage (session
 * cache today, localStorage before it) inside a `useState` initializer (as
 * this used to do) gives the server a `null` tournament and the client's
 * very first render a real one -- two different trees for the same markup,
 * which React detects as a hydration mismatch and throws away the
 * server-rendered DOM to reconcile from scratch. Effects run only after
 * hydration completes on the client, so reading from inside one keeps both
 * renders in agreement: both start in the loading state below, and the real
 * data arrives as an ordinary post-mount update.
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
    const checkedCacheRef = useRef(false);
    /** Set once, from `handleServerResolved`, before `resolved` flips true --
     * see this hook's header. Starts false so nothing writes to localStorage
     * on the strength of an optimistic guess. */
    const signedInRef = useRef(false);

    useEffect(() => {
        if (checkedCacheRef.current) return;
        checkedCacheRef.current = true;

        // Deferred a tick past the effect's own body -- see
        // TournamentPlayer's matching comment on this same pattern. The
        // cache read itself is synchronous, but acting on it (setting state)
        // is kept one step removed from the effect body proper.
        const timer = setTimeout(() => {
            const cached = getSessionTournament(id);
            if (cached) setTournament(cached);

            // With auth off there's no session to wait for either way --
            // whatever the in-tab cache did or didn't have is the final
            // answer. With auth on, this is left false: TournamentServerSync
            // determines the actual sign-in state (below) and is what flips
            // it to true, for both a signed-in and a signed-out visitor.
            if (!authEnabled) setResolved(true);
        }, 0);
        return () => clearTimeout(timer);
    }, [id, authEnabled]);

    const handleServerResolved = useCallback((remote: Tournament | null, signedIn: boolean) => {
        signedInRef.current = signedIn;
        setResolved(true);
        if (remote) {
            setTournament((prev) => prev ?? remote);
            setSessionTournament(remote);
            // Only a signed-in user's copy is durable -- see this hook's
            // header. A guest is reported `resolved` with whatever was
            // already in the in-tab cache (or null) and never reaches here
            // with anything worth writing to localStorage.
            if (signedIn) saveLocalTournament(remote);
        }
    }, []);

    const updateTournament = useCallback((updater: (t: Tournament) => Tournament) => {
        setTournament((prev) => {
            if (!prev) return prev;
            const next = updater(prev);
            setSessionTournament(next); // same-tab continuity, not persistence -- always safe
            if (signedInRef.current) saveLocalTournament(next);
            return next;
        });
    }, []);

    const sync = authEnabled ? (
        <TournamentServerSync id={id} tournament={tournament} onServerResolved={handleServerResolved} />
    ) : null;

    return { tournament, resolved, updateTournament, sync };
}
