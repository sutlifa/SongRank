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
 * work, only for it to *also* persist and show up in /my-rankings):
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
 *   1. On first mount, for a signed-in visitor, fetch the server's copy and
 *      hydrate from whichever of it and this device's copy has MORE VOTES.
 *      Not "local if present, server otherwise" -- see the comment on the
 *      fetch below for the three hundred votes that cost. A signed-out
 *      visitor skips straight to reporting resolved with whatever was
 *      already in memory -- never touching localStorage or the network.
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

        // Whatever this device already has: the in-tab copy if there is one,
        // otherwise its localStorage copy. Either may be ahead of the server
        // (votes cast since the last successful save) or BEHIND it (this
        // device last saw the ranking days ago and it was finished elsewhere).
        const localCopy = tournament ?? loadLocalTournament(id);

        // The server is asked EVEN WHEN we already have a copy, and this is
        // the load-bearing part of the whole file.
        //
        // It used to return early here: a local copy was taken as the answer,
        // reported resolved, and then pushed up by job 2 on the assumption
        // that local is always at least as fresh as the server. That
        // assumption is false in the one case that matters -- a browser
        // holding an OLD copy of a ranking that has since been finished
        // somewhere else -- and it cost a real ranking about three hundred
        // votes: opening it loaded the stale local copy and the autosave
        // wrote it straight over the finished one.
        //
        // So both copies are fetched and the FURTHER ONE WINS. The cost is
        // that a signed-in visitor waits for one request before the ranking
        // renders, where before it could come straight from memory. That is a
        // few hundred milliseconds against the possibility of silently
        // discarding somebody's afternoon, which is not a close call.
        fetch(`/api/tournaments/${id}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((data: { tournament?: Tournament } | null) => {
                const remote = data?.tournament ?? null;
                const localVotes = localCopy?.votes.length ?? -1;
                const remoteVotes = remote?.votes.length ?? -1;

                if (remote && remoteVotes >= localVotes) {
                    // The server is level or ahead. Adopting it also means the
                    // two genuinely agree, which is the only honest reason to
                    // set this ref -- it stops job 2 from PUTting back exactly
                    // what was just read.
                    savedVoteCountRef.current = remoteVotes;
                    onServerResolved(remote, true);
                    return;
                }
                // Local is ahead (or the server has nothing). Leave the ref
                // null so job 2 pushes this copy up, which is also what
                // repairs a save that failed or was missed earlier.
                onServerResolved(localCopy, true);
            })
            .catch(() => {
                // Offline, or the request failed. Use what this device has --
                // the ranking must still be playable -- and leave the ref null
                // so a save is attempted. If that save would discard votes,
                // the server refuses it (see UNDO_SLACK in lib/queries.ts);
                // this client is deliberately not the last line of defence.
                onServerResolved(localCopy, true);
            });
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
