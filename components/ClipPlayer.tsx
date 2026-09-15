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

    // iTunes doesn't always report a preview length; 30s is the format's
    // fixed length in every case we've seen, so it's a safe assumption when
    // the field is missing rather than an arbitrary guess.
    const duration = previewSeconds ?? 30;
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
        const seekToTarget = () => {
            try {
                audio.currentTime = target;
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
