"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import type { Tournament } from "@/lib/types";
import { loadLocalTournament } from "@/lib/localTournaments";
import { tournamentFormat } from "@/lib/tournamentEngine";

/**
 * The signed-in half of tournament persistence: renders nothing, just syncs.
 *
 * Only ever mounted from inside `{authEnabled && <TournamentServerSync .../>}`
 * (see components/Providers.tsx's header for why that gating exists), so
 * `useSession()` below can assume a `SessionProvider` is always present.
 *
 * Three jobs, all silent on failure (a signed-out or offline signed-in user's
 * tournament is already safe in lib/sessionCache.ts's in-tab cache -- see
 * TournamentPlayer -- so nothing here is load-bearing for the tournament to
 * work, only for it to *also* persist and show up in /history):
 *
 *   0. Report whether this visitor is actually signed in, not just whether
 *      the deployment has auth configured -- `authEnabled` (the prop that
 *      gates whether this component mounts at all) says nothing about *this*
 *      visitor's session. "Save and resume should only work on signed in
 *      users" (see useTournamentLoader.tsx's header) means every localStorage
 *      read/write below, and the debounced autosave in job 2, must be gated
 *      on the real answer -- a signed-out visitor on an auth-enabled
 *      deployment gets exactly the same "no persistence" treatment as one on
 *      a deployment with no auth at all.
 *   1. On first mount, if there's no local copy yet AND the visitor is signed
 *      in, try to fetch one from the server (they opened a /t/[id] link on a
 *      new device). A signed-out visitor skips straight to reporting
 *      resolved with whatever was already in memory -- never touching
 *      localStorage or the network.
 *   2. On every change to `tournament` afterward, for a signed-in visitor
 *      only, PUT the current state to the server, debounced so a burst of
 *      undo/redo clicks doesn't fire one request per click.
 */
export default function TournamentServerSync({
    id,
    tournament,
    onServerResolved,
}: {
    id: string;
    tournament: Tournament | null;
    /** Called exactly once, with the tournament to hydrate from (or null if
     * there isn't one) and whether this visitor is actually signed in. */
    onServerResolved: (remote: Tournament | null, signedIn: boolean) => void;
}) {
    const { data: session, status } = useSession();
    const resolvedRef = useRef(false);
    /**
     * How many votes we have CONFIRMED are on the server -- not how many the
     * page is showing. Job 2 skips the autosave when the two agree, so
     * anything written here is a claim that the server already has that state.
     *
     * Only ever set from a server response: the fetch in job 1 (which is the
     * server's own answer) and a successful PUT in job 2. The in-memory and
     * localStorage paths below deliberately leave it null, because both can be
     * AHEAD of the server -- that is exactly the case where a save is still
     * owed, and claiming otherwise is how a finished ranking ends up stored
     * with no votes in it.
     */
    const savedVoteCountRef = useRef<number | null>(null);

    // Job 0 + 1: resolve a starting tournament, once, as soon as we know
    // whether there's a session -- and which persistence tier that implies.
    useEffect(() => {
        if (status === "loading" || resolvedRef.current) return;
        resolvedRef.current = true;
        const signedIn = Boolean(session?.user);

        if (!signedIn) {
            // Guests get no persistence at all (product decision, see this
            // file's header) -- report resolved immediately with whatever
            // the caller already has in memory, never touching localStorage
            // or the network.
            onServerResolved(tournament, false);
            return;
        }

        if (tournament) {
            // Already have an in-memory copy -- nothing to fetch, and it
            // counts as "resolved" as far as the loading state goes.
            //
            // savedVoteCountRef is deliberately NOT set here. This copy came
            // from this tab, not from the server, so it may well be ahead of
            // what is stored -- most sharply when the player has just
            // redirected here on the final vote, which is the one vote that
            // completes a ranking. Marking it "saved" on that basis is what
            // used to leave a finished ranking sitting in the database a vote
            // short, or (after a fast burst of votes that outran the debounce)
            // with no votes at all -- invisible to the owner, who sees their
            // own correct copy locally, and wrong for everyone else the moment
            // the ranking is public.
            onServerResolved(tournament, true);
            return;
        }

        // No in-memory copy yet: this device's local cache is checked before
        // asking the server, same as before this feature existed -- unchanged
        // behavior for a signed-in user, per the product decision.
        const local = loadLocalTournament(id);
        if (local) {
            // Same reasoning as the in-memory path above: localStorage is
            // written on every vote, so it is at least as fresh as the server
            // and frequently fresher. Leaving the ref null lets job 2 push it
            // up, which also repairs any divergence left by an earlier failed
            // or missed save.
            onServerResolved(local, true);
            return;
        }

        fetch(`/api/tournaments/${id}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((data: { tournament?: Tournament } | null) => {
                // This one IS the server's state, so it is the one path that
                // can honestly claim the two agree -- and doing so stops job 2
                // from immediately PUTting straight back what we just read.
                if (data?.tournament) savedVoteCountRef.current = data.tournament.votes.length;
                onServerResolved(data?.tournament ?? null, true);
            })
            .catch(() => onServerResolved(null, true));
        // onServerResolved is a stable setState wrapper from the parent; the
        // resolvedRef guard is what actually prevents this from re-running.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status, session, id]);

    // Job 2: debounced autosave on every subsequent change, signed-in only.
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
                    // A tournament loaded before `format`/`depth` existed has
                    // neither field at all -- tournamentFormat() applies the
                    // same "absent means swiss" default a fresh read from the
                    // database would, so re-saving an old tournament can
                    // never flip it to a format it was never played under.
                    format: tournamentFormat(tournament),
                    depth: tournament.depth ?? null,
                    songs: tournament.songs,
                    votes: tournament.votes,
                }),
            })
                .then(() => {
                    savedVoteCountRef.current = tournament.votes.length;
                })
                .catch(() => {
                    // Best-effort: the vote is already safe in this tab's
                    // in-memory cache and localStorage; a failed autosave
                    // just means this device's history entry is stale until
                    // the next successful save.
                });
        }, 500);

        return () => clearTimeout(timer);
    }, [session, tournament, id]);

    return null;
}
