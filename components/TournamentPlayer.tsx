"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { derive, recordVote, undoLastVote } from "@/lib/swiss";
import SongCard from "./SongCard";
import type { ClipPlayerHandle } from "./ClipPlayer";
import StandingsPeek from "./StandingsPeek";
import { useTournamentLoader } from "./useTournamentLoader";

export default function TournamentPlayer({ id, authEnabled }: { id: string; authEnabled: boolean }) {
    const router = useRouter();
    const { tournament, resolved, updateTournament, sync } = useTournamentLoader(id, authEnabled);

    const leftPlayerRef = useRef<ClipPlayerHandle>(null);
    const rightPlayerRef = useRef<ClipPlayerHandle>(null);
    const activeAudioRef = useRef<HTMLAudioElement | null>(null);

    // Ratchet for the overall progress bar, kept as state (not a ref read
    // during render -- React's rules disallow that) and only ever updated
    // from inside the effect below.
    //
    // `derived.matchupsPlanned` is documented in lib/swiss.ts as a lower
    // bound that can jump upward in a single step right as a playoff round
    // starts (the whole new round's matchup count lands in the denominator
    // before any of it is played), which makes the raw played/planned ratio
    // dip at that exact moment even though real progress never went
    // backwards. This turns that into "never show a lower percentage than we
    // already have, unless the player actually hit Undo" -- distinguished by
    // comparing matchupsPlayed run to run, since that's the one signal that
    // tells a real regression (undo) apart from a denominator-only jump
    // (matchupsPlayed unchanged).
    const [progressPct, setProgressPct] = useState(0);
    const lastMatchupsPlayedRef = useRef(0);

    const vote = useCallback(
        (pairingId: string, winnerId: string) => updateTournament((t) => recordVote(t, pairingId, winnerId)),
        [updateTournament]
    );

    const undo = useCallback(() => updateTournament((t) => undoLastVote(t)), [updateTournament]);

    const derived = useMemo(() => (tournament ? derive(tournament) : null), [tournament]);

    // A tournament that's already finished (resumed from a link, or the last
    // vote just landed) belongs on the results page, not the matchup screen.
    useEffect(() => {
        if (derived?.status === "complete") router.replace(`/t/${id}/results`);
    }, [derived?.status, id, router]);

    // Updates the progress-bar ratchet declared above. Deferred a tick past
    // the effect's own synchronous body (rather than calling setProgressPct
    // inline here) for the same reason as TournamentServerSync/ExportPanel's
    // similar effects: this is reacting to `derived` changing, not deriving
    // view output *from* render inputs, so acting on it belongs one step
    // removed from the render/effect body itself.
    useEffect(() => {
        if (!derived) return;
        const matchupsPlayed = derived.matchupsPlayed;
        const rawPct = Math.min(100, Math.round((matchupsPlayed / Math.max(1, derived.matchupsPlanned)) * 100));

        // Snapshot the previous count BEFORE scheduling anything, and read the
        // snapshot -- not the ref -- inside the updater.
        //
        // This looks like needless ceremony and is not. `setProgressPct(fn)`
        // does not run `fn` synchronously; React defers it to a later render
        // pass. So writing `lastMatchupsPlayedRef.current = matchupsPlayed` on
        // the line after the setState call -- which is what this used to do --
        // clobbers the ref long before the updater ever reads it, leaving the
        // comparison as `matchupsPlayed < matchupsPlayed`: false every time,
        // forward or backward. The ratchet then had only its Math.max branch,
        // which happens to give the right answer while voting forward (max
        // picks the larger, correct value) and silently freezes the bar at its
        // all-time high the moment someone hits Undo. Forward-play testing
        // cannot see this bug; only undo can.
        const previousMatchupsPlayed = lastMatchupsPlayedRef.current;
        lastMatchupsPlayedRef.current = matchupsPlayed;

        const timer = setTimeout(() => {
            setProgressPct((prev) =>
                matchupsPlayed < previousMatchupsPlayed ? rawPct : Math.max(prev, rawPct)
            );
        }, 0);
        return () => clearTimeout(timer);
    }, [derived]);

    // Keyboard shortcuts: A/B play a clip, arrow keys vote. Ignored while
    // focus is in a text field so typing "a" or pressing an arrow key in some
    // future input doesn't double as a vote.
    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            if (!derived?.current) return;
            const target = e.target as HTMLElement | null;
            if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;

            const { pairing } = derived.current;
            const key = e.key.toLowerCase();
            if (key === "a") {
                e.preventDefault();
                leftPlayerRef.current?.playClip();
            } else if (key === "b") {
                e.preventDefault();
                rightPlayerRef.current?.playClip();
            } else if (e.key === "ArrowLeft") {
                e.preventDefault();
                vote(pairing.id, pairing.a);
            } else if (e.key === "ArrowRight" && pairing.b) {
                e.preventDefault();
                vote(pairing.id, pairing.b);
            }
        }
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [derived, vote]);

    if (!resolved) {
        return (
            <div className="mx-auto max-w-4xl px-4 py-16 text-center text-fg-muted sm:px-6">
            {/* `sync` MUST render in every branch, this one included.
                With `authEnabled`, useTournamentLoader deliberately leaves
                `resolved` false and waits for TournamentServerSync -- which
                IS `sync` -- to call onServerResolved. Returning early without
                rendering it deadlocks a signed-in user on this very screen
                forever: resolved can't flip until sync mounts, and sync can't
                mount until resolved flips. Keeping it mounted in all branches
                also stops its internal resolvedRef from being reset by an
                unmount/remount as the branches switch. */}
            {sync}
                Loading your tournament…
            </div>
        );
    }

    if (!tournament || !derived) {
        return (
            <div className="mx-auto max-w-lg px-4 py-16 text-center sm:px-6">
                {sync}
                <h1 className="mb-2 text-xl font-bold">Tournament not found</h1>
                <p className="mb-6 text-sm text-fg-muted">
                    This link doesn&apos;t match a tournament on this device
                    {authEnabled ? " or your saved history" : ""}. It may have been played on a
                    different browser, or the link is mistyped.
                </p>
                <Link href="/new" className="btn-primary">
                    Start a new tournament
                </Link>
            </div>
        );
    }

    const songById = new Map(tournament.songs.map((s) => [s.id, s]));
    const current = derived.current;

    return (
        <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
            {sync}

            <header className="mb-6">
                <h1 className="truncate text-xl font-bold sm:text-2xl">{tournament.name}</h1>
                {current && (
                    <p className="mt-1 text-sm text-fg-muted">
                        {current.round.label} · Matchup {current.numberInRound} of {current.matchupsInRound}
                    </p>
                )}
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-bg-soft-2">
                    <div
                        className="h-full rounded-full bg-accent transition-[width]"
                        style={{ width: `${progressPct}%` }}
                    />
                </div>
                <p className="mt-1 text-xs text-fg-muted">
                    {derived.matchupsPlayed} of{" "}
                    {derived.inPlayoffs ? `at least ${derived.matchupsPlanned}` : derived.matchupsPlanned}{" "}
                    matchups played
                </p>
            </header>

            {current?.round.note && (
                <div className="mb-6 rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-fg">
                    <span className="font-semibold text-accent">{current.round.label}: </span>
                    {current.round.note}
                </div>
            )}

            {current ? (
                <>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <SongCard
                            ref={leftPlayerRef}
                            side="A"
                            song={songById.get(current.pairing.a)!}
                            clipSeconds={tournament.clipSeconds}
                            activeAudioRef={activeAudioRef}
                            onVote={() => vote(current.pairing.id, current.pairing.a)}
                            rematch={current.pairing.isRematch}
                            key={`${current.pairing.id}-a`}
                        />
                        <SongCard
                            ref={rightPlayerRef}
                            side="B"
                            song={songById.get(current.pairing.b!)!}
                            clipSeconds={tournament.clipSeconds}
                            activeAudioRef={activeAudioRef}
                            onVote={() => vote(current.pairing.id, current.pairing.b!)}
                            rematch={current.pairing.isRematch}
                            key={`${current.pairing.id}-b`}
                        />
                    </div>

                    <p className="mt-4 text-center text-xs text-fg-muted">
                        <span className="kbd">A</span> / <span className="kbd">B</span> play a clip ·{" "}
                        <span className="kbd">←</span> / <span className="kbd">→</span> vote
                    </p>
                </>
            ) : (
                <p className="py-16 text-center text-fg-muted">Finishing up…</p>
            )}

            <div className="mt-6 flex items-center justify-between gap-4">
                <button
                    type="button"
                    onClick={undo}
                    disabled={tournament.votes.length === 0}
                    className="btn-secondary"
                >
                    ↩ Undo last vote
                </button>
                <span className="text-xs text-fg-muted">{tournament.songs.length} songs</span>
            </div>

            <div className="mt-8">
                <StandingsPeek standings={derived.standings} songs={tournament.songs} />
            </div>
        </div>
    );
}
