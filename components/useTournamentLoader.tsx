"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { SearchResult, Tournament } from "@/lib/types";
import { saveLocalTournament } from "@/lib/localTournaments";
import { getSessionTournament, setSessionTournament } from "@/lib/sessionCache";
import { tournamentFormat } from "@/lib/tournamentEngine";
import { swapSongVersion } from "@/lib/songVersion";
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
    renameTournament: (nextName: string) => void;
    changeSongVersion: (songId: string, version: SearchResult) => void;
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

    /**
     * Renames the current tournament in place. Reuses `updateTournament`'s
     * plumbing (session cache always, localStorage when signed in) for the
     * in-memory/local-device side, but -- unlike a vote -- can't ride
     * TournamentServerSync's debounced autosave to reach the server: job 2
     * there only fires when `votes.length` changes (see that file's header),
     * so a rename with no accompanying vote would never get PUT at all.
     * This calls the same PUT /api/tournaments/[id] endpoint directly
     * instead, with the same body shape TournamentServerSync's autosave
     * sends, so the two never disagree about what a "save" looks like.
     *
     * The vote log and every derived field are untouched -- only `name` and
     * `updatedAt` change -- so this can never invalidate a tournament
     * mid-play (see lib/types.ts: a tournament is `{ songs, votes }` and
     * nothing else derives from anything this function writes).
     */
    const renameTournament = useCallback(
        (nextName: string) => {
            setTournament((prev) => {
                if (!prev) return prev;
                const next: Tournament = { ...prev, name: nextName, updatedAt: new Date().toISOString() };
                setSessionTournament(next);
                if (signedInRef.current) {
                    saveLocalTournament(next);
                    fetch(`/api/tournaments/${id}`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            name: next.name,
                            clipSeconds: next.clipSeconds,
                            format: tournamentFormat(next),
                            depth: next.depth ?? null,
                            songs: next.songs,
                            votes: next.votes,
                        }),
                    }).catch(() => {
                        // Best-effort, same as TournamentServerSync's autosave:
                        // the rename is already safe in this tab's in-memory
                        // cache and localStorage; a failed PUT just means this
                        // device's history entry is stale until the next
                        // successful save (the next vote's autosave will carry
                        // the new name along too, since it reads from `next`).
                    });
                }
                return next;
            });
        },
        [id]
    );

    /**
     * Swaps which recording one song entry points to -- see
     * lib/songVersion.ts for the operation itself and the invariant it
     * rests on (the entry's `id`, which is all any vote or pairing id ever
     * references, never changes). This is the "Change version" control's
     * only way to reach tournament state, from either the matchup screen
     * (components/TournamentPlayer.tsx via components/SongCard.tsx) or the
     * results screen (components/ResultsView.tsx).
     *
     * Deliberately its own targeted update, following `renameTournament`'s
     * shape immediately above rather than the general-purpose
     * `updateTournament`: a version swap never changes `votes.length` (see
     * lib/songVersion.ts -- it only ever touches `songs`), and
     * TournamentServerSync's autosave (job 2 in that file) is gated
     * specifically on `votes.length` changing, so a swap made through
     * `updateTournament` would update this tab's in-memory state and
     * localStorage but would *never* reach the server for a signed-in user.
     * This PUTs directly, with the same body shape every other targeted
     * update in this file sends, so a swap is durable the moment it's made
     * rather than silently waiting for a vote that might not come for a
     * while (the user could be on /t/[id]/results, where there's no vote
     * left to cast at all).
     */
    const changeSongVersion = useCallback(
        (songId: string, version: SearchResult) => {
            setTournament((prev) => {
                if (!prev) return prev;
                const next = swapSongVersion(prev, songId, version);
                // swapSongVersion returns the same reference, unchanged,
                // when songId isn't actually in this tournament -- nothing
                // to persist in that case (see that function's own doc
                // comment for why this can legitimately happen).
                if (next === prev) return prev;
                setSessionTournament(next);
                if (signedInRef.current) {
                    saveLocalTournament(next);
                    fetch(`/api/tournaments/${id}`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            name: next.name,
                            clipSeconds: next.clipSeconds,
                            format: tournamentFormat(next),
                            depth: next.depth ?? null,
                            songs: next.songs,
                            votes: next.votes,
                        }),
                    }).catch(() => {
                        // Best-effort, same as renameTournament: the swap is
                        // already safe in this tab's in-memory cache and
                        // localStorage; a failed PUT just means this
                        // device's history entry is stale until the next
                        // successful save.
                    });
                }
                return next;
            });
        },
        [id]
    );

    const sync = authEnabled ? (
        <TournamentServerSync id={id} tournament={tournament} onServerResolved={handleServerResolved} />
    ) : null;

    return { tournament, resolved, updateTournament, renameTournament, changeSongVersion, sync };
}
