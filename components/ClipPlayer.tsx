"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { ClipSeconds } from "@/lib/types";
import { gainForPreview } from "@/lib/loudness";

export interface ClipPlayerHandle {
    /**
     * Pauses if this player is the one currently playing, otherwise resumes it
     * from wherever it was left. Used by the matchup screen's A/B keyboard
     * shortcuts.
     *
     * A/B are toggles rather than restart-only because pressing the key for a
     * song you are already hearing obviously means "stop" -- restarting the
     * same clip from the top is the one thing the user cannot have wanted.
     * By the same argument, pressing it *again* means "carry on", not "start
     * that thirty seconds over"; see `startPlayback` for how resuming works.
     */
    toggleClip: () => void;
    /** Pauses this player if it is playing. Safe to call when it isn't. */
    pause: () => void;
}

interface Props {
    previewUrl: string | null;
    previewSeconds: number | null;
    previewNote: string | null;
    clipSeconds: ClipSeconds;
    /** Shared between the two players in a matchup so starting one pauses the other. */
    activeAudioRef: React.MutableRefObject<HTMLAudioElement | null>;
    /** For aria-labels ("Song A" / "Song B"), not shown visually. */
    label: string;
    /**
     * Whether to measure this preview's loudness and pull it down toward a
     * shared level (see lib/loudness.ts). Defaults to true, which is right
     * for every screen that exists to compare two recordings.
     *
     * A screen that plays songs ONE AT A TIME should pass false, and the
     * results list does. Two reasons, and the second is the important one:
     *
     *   - Nothing is being compared there. Levelling exists so a quiet master
     *     doesn't lose a vote it deserved; when you are auditioning a finished
     *     ranking one row at a time there is no vote and no second song, so the
     *     measurement buys nothing.
     *   - Each measurement is a SEPARATE, FULL download of the preview file
     *     (it has to be -- see lib/loudness.ts on why the <audio> element
     *     itself can't be tapped). Bounding that to "the one or two clips a
     *     person can be listening to" is the entire reason it happens on play
     *     rather than on mount (see startPlayback). That bound holds on a
     *     matchup screen, which has exactly two players. It does NOT hold on
     *     a results list, which renders a player per row: someone clicking
     *     down a sixty-song ranking sets sixty full-file fetches racing the
     *     real media requests at the same CDN. That is precisely the burst
     *     that made the pre-flight screen's songs refuse to play, and the
     *     comment in startPlayback describes what it looked like.
     */
    normalise?: boolean;
    /**
     * Asks the caller to fetch a fresh preview URL for this song, when the
     * stored one turns out to be dead. Resolves true if it found one.
     *
     * Optional, and offered to the listener as a button rather than run
     * automatically: see the retry UI below for why the difference matters.
     */
    onRepairPreview?: () => Promise<boolean>;
}

/** Seconds as m:ss, for the elapsed/total readout beside the progress bar. */
function formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const whole = Math.floor(seconds);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * Plays the whole 30-second iTunes preview. It used to play a 15-second window
 * starting a quarter of the way in, on the theory that that was the most
 * chorus-likely stretch; the simpler answer won, because 30 seconds is all the
 * audio that exists and withholding half of it only made comparisons harder.
 *
 * Never autoplays: every play, including the keyboard shortcuts, happens only
 * in response to an explicit user action (a click or a keypress), both of which
 * satisfy browsers' autoplay-gesture requirement and neither of which fires on
 * mount.
 */
const ClipPlayer = forwardRef<ClipPlayerHandle, Props>(function ClipPlayer(
    // `clipSeconds` and `previewSeconds` both stay in Props so callers and
    // saved rankings keep round-tripping them, but neither affects playback any
    // more -- see the window and duration comments below.
    { previewUrl, previewNote, activeAudioRef, label, normalise = true, onRepairPreview },
    ref
) {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [playing, setPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    // True only while the first play of a clip waits for its metadata. Without
    // preload the fetch is visible on a slow connection, and a button that
    // looks inert for a second is what makes people click it twice.
    const [loading, setLoading] = useState(false);
    /**
     * Set when the browser refuses to play this preview -- a rejected play(),
     * or an `error` event off the element itself.
     *
     * It exists because the alternative is a button that does NOTHING when
     * clicked. Playback failing used to be completely invisible: the catch in
     * startPlayback cleared the loading flag and the label fell back to "Play
     * clip", which is indistinguishable from a click that never registered.
     * Someone hitting that can only report "the clips aren't working", with no
     * way to tell a dead network from a dead button -- so the failure says so,
     * and offers the retry that sometimes fixes it.
     */
    const [failed, setFailed] = useState(false);
    /** "looking" while a repair is in flight, "gave-up" when it found nothing. */
    const [repair, setRepair] = useState<"idle" | "looking" | "gave-up">("idle");

    // The real duration, read off the audio element once its metadata loads.
    // The only trustworthy source there is -- see the `duration` comment below
    // for why the catalogue's own figure is not used.
    const [actualDuration, setActualDuration] = useState<number | null>(null);
    // Measured volume multiplier for the current preview (1 until known, and
    // 1 forever if it cannot be measured). A ref, not state: nothing renders
    // from it, and re-rendering the player mid-clip to record a number the
    // user cannot see would be wasted work.
    const gainRef = useRef(1);
    /** Whether the current preview has already had its loudness measured. */
    const measuredRef = useRef(false);

    // Measured length, or 30 as the placeholder until it is measured. The
    // stored `previewSeconds` is deliberately NOT consulted.
    //
    // It used to be, and it produced exactly the confusing behaviour this
    // replaces: rankings saved before the trackTimeMillis fix carry a
    // previewSeconds equal to the WHOLE SONG's length, because that is what
    // iTunes' field actually measures. Fixing lib/itunes.ts stopped new
    // lookups recording it but could not correct rows already in the
    // database, so those songs advertised "0:00 / 3:45", played their real
    // 30-second preview, and then snapped the bar to full when it ended --
    // looking for all the world like a song that had skipped to the end.
    //
    // Since a hint that can be wrong by a factor of seven is worth less than
    // no hint at all, and every iTunes preview is 30 seconds anyway, the
    // placeholder is simply 30 until the file itself reports otherwise. That
    // is right for new data, right for old data, and self-correcting the
    // moment metadata loads.
    const duration = actualDuration ?? 30;
    // The clip IS the whole preview now. Apple gives us 30 seconds and that is
    // all the audio there is, so the window runs 0 -> duration: nothing is
    // withheld, and the progress bar below therefore measures the real thing
    // someone is listening to rather than a slice of it.
    //
    // `clipSeconds` is still accepted and still round-trips through saved
    // rankings, but it no longer shortens playback -- an older ranking saved
    // with 10 or 15 plays its full preview like everything else.
    const windowStart = 0;
    const windowEnd = duration;

    // Reset when the source changes -- e.g. "Change version" swapping a song's
    // recording underneath a mounted player.
    //
    // React updates the <audio> element's `src` attribute, but the element
    // itself is not remounted, so it keeps everything about the previous file:
    // its buffered data, its readyState, and (crucially) the duration this
    // component measured off the old recording. Without an explicit `load()`
    // the next play either replayed stale audio or sat there doing nothing,
    // which is why a swapped song appeared to need a page refresh before it
    // would play. Clearing the measured duration matters just as much: the clip
    // window is derived from it, so carrying the old file's length over would
    // seek the new one to the wrong place.
    //
    // This load() briefly did NOT run on the effect's first pass, on the
    // theory that a fresh element has nothing to reset and that skipping it
    // would stop a long results list from instantiating a media player per
    // row. It was reverted: it was speculative -- aimed at a browser
    // media-player cap that was never confirmed to be the problem -- and it
    // was followed immediately by reports of clips failing to load on every
    // matchup after the first, which is precisely the shape of an element
    // that was never told to go and get its source. The real cause of the
    // clip failures turned out to be dead preview URLs (see
    // refreshSongPreview in useTournamentLoader), which this never addressed.
    // A redundant load() costs nothing anyone has measured; not loading cost
    // somebody their clips.
    useEffect(() => {
        const audio = audioRef.current;
        setActualDuration(null);
        setProgress(0);
        setLoading(false);
        setFailed(false);
        setRepair("idle");
        gainRef.current = 1;
        measuredRef.current = false;
        if (audio) {
            audio.volume = 1;
            audio.pause();
            // Only ask for a reload when there is something to load; calling
            // load() with an empty src makes some browsers log a spurious error.
            if (previewUrl) audio.load();
        }
    }, [previewUrl]);

    useImperativeHandle(ref, () => ({
        toggleClip: () => {
            // `playing` is kept in sync by the element's own play/pause event
            // listeners, so it is accurate even when playback was started or
            // stopped by something other than this handle.
            if (playing) audioRef.current?.pause();
            else startPlayback({ restart: false });
        },
        pause: () => audioRef.current?.pause(),
    }));

    /**
     * Starts this player.
     *
     * `restart: false` RESUMES from wherever the element was left, and that is
     * the default everywhere a person presses play. Pausing a clip and pressing
     * play again used to seek back to 0:00 unconditionally, as did coming back
     * to a song after listening to the other one -- so comparing two songs by
     * switching between them meant hearing both openings over and over and
     * never reaching the part you were trying to compare. An <audio> element
     * keeps its `currentTime` across a pause and across a sibling taking over
     * playback, so resuming is simply a matter of NOT seeking.
     *
     * `restart: true` is the replay button, which is the one control that
     * should always go back to the top.
     */
    function startPlayback({ restart }: { restart: boolean }) {
        const audio = audioRef.current;
        if (!audio) return;

        // Only one clip plays at a time across the whole matchup: starting
        // this one pauses whatever the sibling player left running.
        if (activeAudioRef.current && activeAudioRef.current !== audio) {
            activeAudioRef.current.pause();
        }
        activeAudioRef.current = audio;
        // Re-applied on every play: the element's volume is reset to 1 when the
        // source changes, and the measurement may have landed since.
        audio.volume = gainRef.current;
        // A retry gets a clean slate; if it fails again the handlers below put
        // the message straight back.
        setFailed(false);

        // Loudness is measured on first PLAY, never on mount, and that timing
        // is the whole point. Measuring on mount meant the pre-flight screen --
        // which renders a player per row, up to 20 a page -- fired twenty
        // simultaneous full-file downloads at Apple's CDN the moment it opened.
        // A burst like that gets throttled, and the throttling took the real
        // media requests down with it, so songs simply would not play. Tying it
        // to playback bounds it to the one or two clips a person can actually
        // be listening to. It is fire-and-forget: nothing here is awaited, so a
        // slow or blocked measurement never delays the audio.
        //
        // A screen that renders a player per row re-opens that same hole even
        // on this path, which is why it can opt out -- see `normalise` in Props.
        if (normalise && previewUrl && !measuredRef.current) {
            measuredRef.current = true;
            gainForPreview(previewUrl).then((gain) => {
                gainRef.current = gain;
                // The clip is only 30 seconds, so waiting for the *next* play to
                // apply this would often mean never applying it at all.
                if (audioRef.current && audioRef.current.src.includes(previewUrl.slice(-24))) {
                    audioRef.current.volume = gain;
                }
            });
        }

        // "Resume" has nowhere to resume to once a clip has run out, so a
        // finished one starts over. Without this, the play button on a clip
        // that reached the end would look dead: it would "resume" at the last
        // frame and stop again immediately.
        //
        // The 0.05s of slack absorbs the gap between the last `timeupdate` and
        // the true end of the file, which no browser lands on exactly.
        const finished = audio.ended || audio.currentTime >= windowEnd - 0.05;
        const fromStart = restart || finished;
        if (fromStart) {
            // A previous run that reached the end left progress at 1. Clear it
            // now so the bar starts empty instead of flashing the last play's
            // finished state.
            setProgress(0);
        }

        // Two rules collide here, and the order below is the only arrangement
        // that satisfies both. Changing it will reintroduce a bug that has now
        // been fixed twice.
        //
        // Rule 1 -- you cannot seek before the metadata exists. `preload="none"`
        // (deliberate; see this component's header) leaves a fresh <audio> at
        // readyState HAVE_NOTHING with a `duration` of NaN. Assigning
        // `currentTime = 7.5` there does not queue a seek: with no known
        // duration the browser reads it as a seek past the end and fires
        // `ended` at once, which showed as a full progress bar and silence.
        //
        // Rule 2 -- you cannot `await` anything before calling `play()`. Browsers
        // only accept play() as user-initiated while the click's activation
        // token is live, and awaiting `loadedmetadata` outlives it. The first
        // attempt at this fix awaited the metadata and then seeked and played;
        // that obeyed rule 1 and broke rule 2, so the first click loaded the
        // file and played nothing, and it still took two clicks.
        //
        // So: call play() synchronously inside the gesture, and seek separately
        // once the metadata arrives. play() is itself what starts the fetch,
        // and `loadedmetadata` always precedes audible output, so the clip
        // still begins at the right offset rather than from zero.
        const seekToStart = () => {
            // Always the start of the file: the clip is the entire preview, so
            // there is no offset to compute and nothing a bad duration hint
            // could get wrong here any more.
            try {
                audio.currentTime = 0;
            } catch {
                // Safari can still refuse a seek it deems out of range. Playing
                // from wherever the element sits beats not playing at all.
            }
        };

        // Seek unless we are genuinely picking up mid-clip. Resuming is the
        // ONLY case that skips it -- an element sitting at 0:00 is seeked to
        // 0:00, which is a no-op for position but is also the nudge this
        // component has always given a media element before playing it, and
        // removing it from the fresh-element path (as the first version of
        // resume did) is not a change worth making blind.
        const resuming = !fromStart && audio.currentTime > 0;
        if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
            if (!resuming) seekToStart();
        } else {
            setLoading(true);
            const onReady = (event: Event) => {
                audio.removeEventListener("loadedmetadata", onReady);
                audio.removeEventListener("error", onReady);
                setLoading(false);
                if (event.type === "error") {
                    setFailed(true);
                    return;
                }
                // Record the measured length so every later render computes the
                // clip window from the real file rather than the hint.
                if (Number.isFinite(audio.duration) && audio.duration > 0) {
                    setActualDuration(audio.duration);
                }
                // The user may have started the other song while this was
                // loading. If this player no longer holds the shared slot, its
                // seek is stale and must not drag playback back.
                if (activeAudioRef.current !== audio) return;
                // Nothing to seek on a resume -- the element is already sitting
                // where the last pause left it.
                if (!resuming) seekToStart();
            };
            audio.addEventListener("loadedmetadata", onReady);
            audio.addEventListener("error", onReady);
        }

        audio.play().catch(() => {
            // A rejected play() means playback did not start. Blocked autoplay
            // is the benign case and self-corrects on the next real click; a
            // mid-decode error or an unreachable CDN is not, and used to leave
            // the button looking untouched. Say so either way -- a message that
            // clears itself on a successful retry costs nothing, and silence
            // here is what makes "the clips aren't working" unanswerable.
            setLoading(false);
            setFailed(true);
        });
    }

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const onTimeUpdate = () => {
            const a = audioRef.current;
            if (!a) return;
            const clamped = Math.min(Math.max(a.currentTime, windowStart), windowEnd);
            const span = windowEnd - windowStart || 1;
            setProgress((clamped - windowStart) / span);
            // The clip window has no native end -- <audio> only knows about
            // the whole file -- so it's enforced here: once playback crosses
            // the window's end, pause it rather than bleeding into the rest
            // of the preview.
            if (a.currentTime >= windowEnd) a.pause();
        };
        const onPlay = () => {
            setPlaying(true);
            // Sound is coming out, so whatever failed before plainly isn't
            // failing now.
            setFailed(false);
        };
        const onPause = () => setPlaying(false);
        const onEnded = () => {
            setPlaying(false);
            setProgress(1);
        };
        // The element's own error channel, as opposed to a rejected play():
        // a source that 404s, a codec the browser won't take, a connection
        // that dies mid-download. All of them used to be silent.
        const onError = () => {
            setPlaying(false);
            setLoading(false);
            setFailed(true);
        };

        audio.addEventListener("timeupdate", onTimeUpdate);
        audio.addEventListener("play", onPlay);
        audio.addEventListener("pause", onPause);
        audio.addEventListener("ended", onEnded);
        audio.addEventListener("error", onError);
        return () => {
            audio.removeEventListener("timeupdate", onTimeUpdate);
            audio.removeEventListener("play", onPlay);
            audio.removeEventListener("pause", onPause);
            audio.removeEventListener("ended", onEnded);
            audio.removeEventListener("error", onError);
        };
    }, [windowStart, windowEnd]);

    // Belt-and-braces: if this player unmounts mid-playback (the parent
    // remounts a fresh pair on every new matchup via `key`), stop the audio
    // rather than let a detached element keep making sound.
    useEffect(() => () => audioRef.current?.pause(), []);

    if (!previewUrl) {
        return (
            <div className="rounded-lg border border-dashed border-border bg-bg-soft-2/50 px-3 py-4 text-center">
                <p className="text-sm font-medium text-fg">No preview available</p>
                <p className="mt-0.5 text-xs text-fg-muted">
                    {previewNote ?? "This track doesn't have a 30-second clip to play — it's still fully votable."}
                </p>
            </div>
        );
    }

    return (
        <div>
            <audio ref={audioRef} src={previewUrl} preload="none" />

            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => (playing ? audioRef.current?.pause() : startPlayback({ restart: false }))}
                    className="btn-primary !px-3 !py-2"
                    aria-label={playing ? `Pause ${label}` : `Play ${label} clip`}
                >
                    {/* "Resume" rather than "Play clip" once there is a
                        position to resume from, so the button says what it
                        will actually do -- the difference between the two is
                        the whole point of the change that introduced it. */}
                    {playing ? "⏸ Pause" : loading ? "… Loading" : progress > 0 && progress < 1 ? "▶ Resume" : "▶ Play clip"}
                </button>
                <button
                    type="button"
                    onClick={() => startPlayback({ restart: true })}
                    className="btn-ghost !px-2.5 !py-2"
                    title="Replay from the start of the clip"
                    aria-label={`Replay ${label} clip`}
                >
                    ↺
                </button>
            </div>

            {/* Bar plus a readout. The bar alone is a 1.5px line with no
                numbers on it, which is easy to miss entirely and impossible to
                read precisely -- "how far into this am I" deserves an actual
                answer, and the elapsed/total pair gives it. */}
            <div className="mt-2 flex items-center gap-2">
                <div
                    className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-soft-2"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(progress * 100)}
                    aria-label={`${label} clip progress`}
                >
                    <div
                        className="h-full rounded-full bg-accent transition-[width] duration-150 ease-linear"
                        style={{ width: `${Math.round(progress * 100)}%` }}
                    />
                </div>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-fg-muted">
                    {formatTime(progress * (windowEnd - windowStart))} / {formatTime(windowEnd - windowStart)}
                </span>
            </div>

            {/* aria-live so a screen reader hears the failure too: the visual
                cue is a line of text appearing under a button that otherwise
                looks exactly as it did before the click. */}
            {failed && (
                <div className="mt-1.5 text-xs text-fg-muted" role="status" aria-live="polite">
                    {repair === "gave-up" ? (
                        <span>
                            Couldn&apos;t play this clip, and Apple doesn&apos;t have another copy of this exact
                            recording. The song still counts — it just can&apos;t be previewed.
                        </span>
                    ) : (
                        <span>
                            Couldn&apos;t play this clip. Press play to try again
                            {onRepairPreview ? (
                                <>
                                    , or{" "}
                                    {/* Offered, not automatic. Apple moves preview
                                        files, so the stored link dies while the song
                                        is fine -- but repairing it writes to the
                                        ranking, and a finished ranking is something
                                        this app has just promised not to rewrite
                                        behind your back (see ResultsView). A button
                                        keeps the promise and still fixes it in one
                                        click. */}
                                    <button
                                        type="button"
                                        onClick={async () => {
                                            setRepair("looking");
                                            const found = await onRepairPreview();
                                            // On success the new src arrives as a
                                            // prop change, and the reset effect
                                            // above clears `failed` and `repair`
                                            // on its own -- so there is nothing to
                                            // set here but the failure case.
                                            if (!found) setRepair("gave-up");
                                        }}
                                        disabled={repair === "looking"}
                                        className="underline underline-offset-2 hover:text-fg disabled:no-underline"
                                    >
                                        {repair === "looking" ? "looking…" : "look for it again"}
                                    </button>
                                </>
                            ) : null}
                            .
                        </span>
                    )}
                </div>
            )}
        </div>
    );
});

export default ClipPlayer;
