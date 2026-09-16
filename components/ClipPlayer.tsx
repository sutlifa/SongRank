"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { ClipSeconds } from "@/lib/types";

export interface ClipPlayerHandle {
    /** Starts (or restarts) the clip window. Used by the matchup screen's A/B keyboard shortcuts. */
    playClip: () => void;
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
}

/**
 * Plays a 15-second-by-default window starting 25% into a 30s preview -- the
 * most chorus-likely stretch of a typical pop song structure, and a much
 * better bet than the first 15 seconds, which is disproportionately intros
 * and count-ins. Never autoplays: every play, including the keyboard
 * shortcuts, only ever happens in response to an explicit user action (a
 * click or a keypress), both of which satisfy browsers' autoplay-gesture
 * requirement and neither of which fires on mount.
 */
const ClipPlayer = forwardRef<ClipPlayerHandle, Props>(function ClipPlayer(
    { previewUrl, previewSeconds, previewNote, clipSeconds, activeAudioRef, label },
    ref
) {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [mode, setMode] = useState<"clip" | "full">("clip");
    const [playing, setPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    // True only while the first play of a clip waits for its metadata. Without
    // preload the fetch is visible on a slow connection, and a button that
    // looks inert for a second is what makes people click it twice.
    const [loading, setLoading] = useState(false);

    // The real duration, read off the audio element once its metadata loads.
    // This is the only trustworthy source: `previewSeconds` is a hint from a
    // catalogue response, and a wrong hint here is severe -- the clip window
    // is computed from it, so overstating the length seeks past the end of the
    // file, which the browser answers by firing `ended` (a full progress bar
    // and silence). That is exactly what happened when this value was derived
    // from iTunes' `trackTimeMillis`, which measures the whole song rather
    // than its 30-second preview. Prefer measurement over metadata.
    const [actualDuration, setActualDuration] = useState<number | null>(null);

    // 30s is the iTunes preview format's fixed length, so it is the right
    // assumption until the file itself says otherwise -- not an arbitrary
    // guess, but still only a placeholder for the first render.
    const duration = actualDuration ?? previewSeconds ?? 30;
    const clipStart = Math.min(duration * 0.25, Math.max(0, duration - clipSeconds));
    const clipEnd = Math.min(duration, clipStart + clipSeconds);
    const windowStart = mode === "clip" ? clipStart : 0;
    const windowEnd = mode === "clip" ? clipEnd : duration;

    useImperativeHandle(ref, () => ({
        playClip: () => startPlayback("clip"),
    }));

    function startPlayback(nextMode: "clip" | "full") {
        const audio = audioRef.current;
        if (!audio) return;

        // Only one clip plays at a time across the whole matchup: starting
        // this one pauses whatever the sibling player left running.
        if (activeAudioRef.current && activeAudioRef.current !== audio) {
            activeAudioRef.current.pause();
        }
        activeAudioRef.current = audio;

        setMode(nextMode);
        // A previous run that reached the end left progress at 1. Clear it now
        // so the bar starts empty instead of flashing the last play's finished
        // state.
        setProgress(0);

        const target = nextMode === "clip" ? clipStart : 0;

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
        // The clip window is recomputed from the element's own duration rather
        // than reusing the `target` closed over above. That one comes from
        // `previewSeconds`, which is a hint; this one comes from the file.
        //
        // Clamping the stale target is not enough, and that mistake is worth
        // recording: with a hint of 210s against a real 30s preview, a clamp
        // to "just inside the file" put the playhead at 29s, so the clip
        // played one second and stopped. Recomputing the window means a wrong
        // hint changes nothing at all -- the quarter-of-the-way-in offset is
        // taken from whatever the file actually turns out to be.
        const seekToTarget = () => {
            const real = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null;
            const safeTarget =
                nextMode === "full"
                    ? 0
                    : real === null
                      ? target
                      : Math.min(real * 0.25, Math.max(0, real - clipSeconds));
            try {
                audio.currentTime = safeTarget;
            } catch {
                // Safari can still refuse a seek it deems out of range. Playing
                // from wherever the element sits beats not playing at all.
            }
        };

        if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
            seekToTarget();
        } else {
            setLoading(true);
            const onReady = () => {
                audio.removeEventListener("loadedmetadata", onReady);
                audio.removeEventListener("error", onReady);
                setLoading(false);
                // Record the measured length so every later render computes the
                // clip window from the real file rather than the hint.
                if (Number.isFinite(audio.duration) && audio.duration > 0) {
                    setActualDuration(audio.duration);
                }
                // The user may have started the other song while this was
                // loading. If this player no longer holds the shared slot, its
                // seek is stale and must not drag playback back.
                if (activeAudioRef.current !== audio) return;
                seekToTarget();
            };
            audio.addEventListener("loadedmetadata", onReady);
            audio.addEventListener("error", onReady);
        }

        audio.play().catch(() => {
            // A rejected play() (blocked autoplay, a mid-decode error) just
            // means playback didn't start -- the button state below already
            // reflects that via the `pause`/`play` event listeners, so there's
            // nothing further to show.
            setLoading(false);
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
            if (mode === "clip" && a.currentTime >= windowEnd) a.pause();
        };
        const onPlay = () => setPlaying(true);
        const onPause = () => setPlaying(false);
        const onEnded = () => {
            setPlaying(false);
            setProgress(1);
        };

        audio.addEventListener("timeupdate", onTimeUpdate);
        audio.addEventListener("play", onPlay);
        audio.addEventListener("pause", onPause);
        audio.addEventListener("ended", onEnded);
        return () => {
            audio.removeEventListener("timeupdate", onTimeUpdate);
            audio.removeEventListener("play", onPlay);
            audio.removeEventListener("pause", onPause);
            audio.removeEventListener("ended", onEnded);
        };
    }, [mode, windowStart, windowEnd]);

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
                    onClick={() => (playing ? audioRef.current?.pause() : startPlayback(mode))}
                    className="btn-primary !px-3 !py-2"
                    aria-label={playing ? `Pause ${label}` : `Play ${label} clip`}
                >
                    {playing ? "⏸ Pause" : loading ? "… Loading" : "▶ Play clip"}
                </button>
                <button
                    type="button"
                    onClick={() => startPlayback("clip")}
                    className="btn-ghost !px-2.5 !py-2"
                    title="Replay from the start of the clip"
                    aria-label={`Replay ${label} clip`}
                >
                    ↺
                </button>
            </div>

            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-bg-soft-2" aria-hidden="true">
                <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${Math.round(progress * 100)}%` }}
                />
            </div>

            <button
                type="button"
                onClick={() => startPlayback(mode === "full" ? "clip" : "full")}
                className="mt-2 text-xs text-fg-muted underline underline-offset-2 hover:text-fg"
            >
                {mode === "full" ? `Back to the ${clipSeconds}s clip` : `Play full ${Math.round(duration)}s preview`}
            </button>
        </div>
    );
});

export default ClipPlayer;
