"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
    deriveTournament,
    recordVote,
    undoLastVote,
    type UnifiedCurrentMatchup,
} from "@/lib/tournamentEngine";
import SongCard from "./SongCard";
import type { ClipPlayerHandle } from "./ClipPlayer";
import StandingsPeek from "./StandingsPeek";
import EditableTournamentName from "./EditableTournamentName";
import { useTournamentLoader } from "./useTournamentLoader";

/**
 * How long the chosen card stays on screen before the next pair replaces it.
 *
 * Long enough to read what you hit, short enough not to be in the way of
 * someone voting quickly. The point is a misclick: two hundred matchups in,
 * the pairs blur together, and a vote that vanishes the instant you click it
 * leaves you with no idea what you just said -- so no idea whether to undo.
 */
const PICK_PAUSE_MS = 600;

export default function TournamentPlayer({ id, authEnabled }: { id: string; authEnabled: boolean }) {
    const router = useRouter();
    const { tournament, resolved, updateTournament, renameTournament, changeSongVersion, refreshSongPreview, sync } = useTournamentLoader(
        id,
        authEnabled
    );

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
        (pairingId: string, winnerId: string, tie = false) =>
            updateTournament((t) => recordVote(t, pairingId, winnerId, tie)),
        [updateTournament]
    );

    /**
     * The matchup being SHOWN, when that is no longer the one the engine is
     * on -- i.e. during the pause after a vote.
     *
     * The vote itself is recorded immediately; only the picture waits. Doing
     * it the other way round -- hold the vote, animate, commit on a timer --
     * reads more naturally and is wrong: closing the tab or hitting back
     * inside those 600ms would silently drop the vote. Nothing a person has
     * already decided should be sitting in a timeout.
     */
    const [pick, setPick] = useState<{ matchup: UnifiedCurrentMatchup; winnerId: string } | null>(null);

    /** Records a vote and freezes the pair on screen for a beat. */
    const choose = useCallback(
        (matchup: UnifiedCurrentMatchup, winnerId: string, tie = false) => {
            // Ignore anything that arrives mid-pause: a second click, or a
            // keyboard repeat. Without this a double-click votes twice, on two
            // different matchups, and the second one is invisible.
            if (pick) return;
            vote(matchup.pairingId, winnerId, tie);
            setPick({ matchup, winnerId });
        },
        [pick, vote]
    );

    useEffect(() => {
        if (!pick) return;
        const timer = setTimeout(() => setPick(null), PICK_PAUSE_MS);
        return () => clearTimeout(timer);
    }, [pick]);

    const undo = useCallback(() => {
        // Clear the freeze first, or undoing during the pause would leave the
        // old pair on screen looking like the undo hadn't worked.
        setPick(null);
        updateTournament((t) => undoLastVote(t));
    }, [updateTournament]);

    const derived = useMemo(() => (tournament ? deriveTournament(tournament) : null), [tournament]);

    // Confirmation that the coin flip did something, since the screen moves
    // straight to the next matchup and otherwise the click would look like it
    // was swallowed. Cleared on a timer by the effect below.
    // A counter, not a boolean: two flips in a row have to restart the
    // timer, and setting a boolean that is already true is a no-op React
    // never re-renders for, so the effect below would never re-fire.
    const [flipNote, setFlipNote] = useState(0);

    /**
     * "Flip a coin": the answer for a matchup the listener genuinely can't
     * separate.
     *
     * Recorded as a tie, so the ratings treat it as a draw and neither song is
     * credited with a win it didn't earn. The random pick is only what fills
     * `Vote.winnerId`, which a tie vote still carries -- see its doc comment in
     * lib/types.ts for why it is present and why it is random rather than
     * always the A side. Nothing the user sees depends on which way it landed,
     * because as far as the ranking is concerned it didn't land either way.
     */
    const flipCoin = useCallback(
        (matchup: UnifiedCurrentMatchup) => {
            choose(matchup, Math.random() < 0.5 ? matchup.a : matchup.b, true);
            setFlipNote((n) => n + 1);
        },
        [choose]
    );

    useEffect(() => {
        if (flipNote === 0) return;
        const timer = setTimeout(() => setFlipNote(0), 2600);
        return () => clearTimeout(timer);
    }, [flipNote]);

    // A tournament that's already finished (resumed from a link, or the last
    // vote just landed) belongs on the results page, not the matchup screen.
    useEffect(() => {
        // Not while a pick is still on screen: the last vote of a ranking
        // deserves the same beat as every other one, rather than the results
        // page appearing out from under the click.
        if (pick) return;
        if (derived?.status === "complete") router.replace(`/t/${id}/results`);
    }, [derived?.status, id, router, pick]);

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

    // Keyboard shortcuts: A/B play or pause that side's clip, Space stops
    // whichever side is playing, arrow keys vote. All ignored while focus is in
    // a text field, so typing "a" or pressing an arrow key in some future input
    // doesn't double as a vote.
    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            if (!derived?.current) return;
            // Same reason the buttons are disabled mid-pause: a held arrow key
            // would otherwise fire a second vote on a matchup that isn't on
            // screen yet.
            if (pick) return;
            const target = e.target as HTMLElement | null;
            if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;

            // A "Change version" panel (see ChangeVersionControl, opened from
            // either SongCard) is a modal stacked above this screen. Its own
            // search input is already covered by the INPUT check just above,
            // but focus can land elsewhere inside it -- the "Use this" button,
            // or nowhere in particular after a click -- and from there an
            // arrow key must not vote on the matchup sitting underneath, nor
            // should "a"/"b" start a clip the user can't currently see. Checked
            // by role rather than threaded through props/state so this stays
            // decoupled from which card's copy of the panel is open.
            if (document.querySelector('[role="dialog"]')) return;

            const current = derived.current;
            const key = e.key.toLowerCase();
            if (key === "a") {
                e.preventDefault();
                leftPlayerRef.current?.toggleClip();
            } else if (key === "b") {
                e.preventDefault();
                rightPlayerRef.current?.toggleClip();
            } else if (e.key === " " || e.key === "Spacebar") {
                // Space stops whatever is playing, whichever side it is, so
                // there is one key to reach for when someone walks in and you
                // need silence -- without first working out whether it was A or
                // B that you started. preventDefault because space would
                // otherwise scroll the page.
                e.preventDefault();
                leftPlayerRef.current?.pause();
                rightPlayerRef.current?.pause();
            } else if (e.key === "ArrowLeft") {
                e.preventDefault();
                choose(current, current.a);
            } else if (e.key === "ArrowRight") {
                e.preventDefault();
                choose(current, current.b);
            } else if (key === "c" && derived.supportsTies) {
                // Guarded on supportsTies for the same reason the button is:
                // a Swiss ranking has no draw to record, so the key must not
                // quietly do something else there instead.
                e.preventDefault();
                flipCoin(current);
            }
        }
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [derived, choose, flipCoin, pick]);

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
                Loading your ranking…
            </div>
        );
    }

    if (!tournament || !derived) {
        return (
            <div className="mx-auto max-w-lg px-4 py-16 text-center sm:px-6">
                {sync}
                <h1 className="mb-2 text-xl font-bold">Ranking not found</h1>
                <p className="mb-6 text-sm text-fg-muted">
                    This link doesn&apos;t match a ranking on this device
                    {authEnabled ? " or your saved history" : ""}. It may have been played on a
                    different browser, or the link is mistyped.
                </p>
                <Link href="/new" className="btn-primary">
                    Start a new ranking
                </Link>
            </div>
        );
    }

    const songById = new Map(tournament.songs.map((s) => [s.id, s]));
    /**
     * The pair on screen: the frozen one during the pause after a vote,
     * otherwise whatever the engine is on.
     *
     * Everything about the MATCHUP reads from this -- the label, the cards,
     * the vote handlers -- so the frozen pair stays internally consistent.
     * The progress bar and the matchup count deliberately keep reading
     * `derived`, because those describe the ranking rather than the pair, and
     * seeing them move is the confirmation that the vote landed.
     */
    const current = pick?.matchup ?? derived.current;
    /** Which side of the shown pair was chosen, during the pause. */
    const pickedSide = (songId: string): "winner" | "loser" | null =>
        pick ? (pick.winnerId === songId ? "winner" : "loser") : null;

    return (
        <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
            {sync}

            <header className="mb-6">
                <EditableTournamentName name={tournament.name} onRename={renameTournament} />
                {current && (
                    <p className="mt-1 text-sm text-fg-muted">
                        {current.label} · Matchup {current.numberInRound} of {current.matchupsInRound}
                    </p>
                )}
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-bg-soft-2">
                    <div
                        className="h-full rounded-full bg-accent transition-[width]"
                        style={{ width: `${progressPct}%` }}
                    />
                </div>
                <p className="mt-1 text-xs text-fg-muted">
                    {/* Matchups played, and nothing else.
                        There used to be a "ranking is N% settled" figure
                        here. It was accurate and it was read as the opposite
                        of what it meant: it counts the fraction of ALL pairs
                        whose order is provable beyond the uncertainty in
                        their two ratings, which on a big list includes
                        neighbours a handful of rating points apart, where
                        "these two are a coin flip" is the true answer. So a
                        ranking whose order is about 97% right (that is the
                        measured rank correlation -- see the correlation
                        section of scripts/verify-ranking.ts) advertised
                        itself as 83%, and read as "17% of this is wrong".
                        A number nobody can act on, that makes finished work
                        look broken, is worse than no number. */}
                    {derived.matchupsPlayed} of{" "}
                    {derived.inPlayoffs ? `at least ${derived.matchupsPlanned}` : derived.matchupsPlanned}{" "}
                    matchups played
                </p>
            </header>

            {current?.note && (
                <div className="mb-6 rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-fg">
                    <span className="font-semibold text-accent">{current.label}: </span>
                    {current.note}
                </div>
            )}

            {current ? (
                <>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <SongCard
                            ref={leftPlayerRef}
                            side="A"
                            song={songById.get(current.a)!}
                            clipSeconds={tournament.clipSeconds}
                            activeAudioRef={activeAudioRef}
                            onVote={() => choose(current, current.a)}
                            onChangeVersion={(version) => changeSongVersion(current.a, version)}
                            onRepairPreview={() => refreshSongPreview(current.a)}
                            rematch={current.isRematch}
                            picked={pickedSide(current.a)}
                            disabled={Boolean(pick)}
                            key={`${current.pairingId}-a`}
                        />
                        <SongCard
                            ref={rightPlayerRef}
                            side="B"
                            song={songById.get(current.b)!}
                            clipSeconds={tournament.clipSeconds}
                            activeAudioRef={activeAudioRef}
                            onVote={() => choose(current, current.b)}
                            onChangeVersion={(version) => changeSongVersion(current.b, version)}
                            onRepairPreview={() => refreshSongPreview(current.b)}
                            rematch={current.isRematch}
                            picked={pickedSide(current.b)}
                            disabled={Boolean(pick)}
                            key={`${current.pairingId}-b`}
                        />
                    </div>

                    {derived.supportsTies && (
                        <div className="mt-4 flex flex-col items-center gap-2">
                            <button
                                type="button"
                                onClick={() => flipCoin(current)}
                                disabled={Boolean(pick)}
                                className="btn-secondary disabled:opacity-40"
                                title="Records this matchup as a tie: neither song gains or loses ground."
                            >
                                🪙 Can&apos;t decide — flip a coin
                            </button>
                            <p
                                // aria-live so the confirmation is announced
                                // rather than only seen; the element is always
                                // present (not conditionally rendered) because
                                // a live region has to exist before its content
                                // changes for a screen reader to pick it up.
                                aria-live="polite"
                                className={`text-xs transition-opacity ${
                                    flipNote > 0 ? "text-accent opacity-100" : "opacity-0"
                                }`}
                            >
                                {flipNote > 0
                                    ? "Called it a tie — neither song gained or lost ground."
                                    : "\u00a0"}
                            </p>
                        </div>
                    )}

                    {/* Replaces the shortcut line during the pause rather than
                        sitting alongside it: the whole reason for the pause is
                        to say what just happened and what to do if it was
                        wrong, and that reads badly competing with a keyboard
                        legend. aria-live so it is announced, not just seen. */}
                    <p className="mt-4 text-center text-xs" aria-live="polite">
                        {pick ? (
                            <span className="text-accent">
                                Picked{" "}
                                <span className="font-semibold">
                                    {songById.get(pick.winnerId)?.title ?? "that one"}
                                </span>{" "}
                                — not what you meant? Hit Undo below.
                            </span>
                        ) : (
                            <span className="text-fg-muted">
                                <span className="kbd">A</span> / <span className="kbd">B</span> play or
                                pause a clip · <span className="kbd">Space</span> stop ·{" "}
                                <span className="kbd">←</span> / <span className="kbd">→</span> vote
                                {derived.supportsTies && (
                                    <>
                                        {" "}
                                        · <span className="kbd">C</span> flip a coin
                                    </>
                                )}
                            </span>
                        )}
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
