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

    async function startPlayback(nextMode: "clip" | "full") {
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

        // Seeking before the browser has the file's metadata is the entire
        // reason this used to need two clicks to start.
        //
        // `preload="none"` (deliberate -- see this component's header) means a
        // fresh <audio> sits at readyState HAVE_NOTHING with a `duration` of
        // NaN. Assigning `currentTime = 7.5` in that state does not queue a
        // seek to 7.5 seconds: with no known duration the browser treats it as
        // a seek past the end and fires `ended` immediately. That set `playing`
        // false and `progress` to 1 -- a full bar and silence -- and only the
        // second click worked, because by then the metadata was cached and the
        // seek finally meant something.
        //
        // So load the metadata first when we don't have it, and only then seek.
        // `load()` is what starts the fetch, since preload="none" means nothing
        // is requested until something asks. Both success and error resolve the
        // promise: a preview URL that 404s should fall through to `play()` and
        // surface as an ordinary playback failure rather than hanging here.
        if (audio.readyState < HTMLMediaElement.HAVE_METADATA) {
            setLoading(true);
            await new Promise<void>((resolve) => {
                const done = () => {
                    audio.removeEventListener("loadedmetadata", done);
                    audio.removeEventListener("error", done);
                    resolve();
                };
                audio.addEventListener("loadedmetadata", done);
                audio.addEventListener("error", done);
                audio.load();
            });
            setLoading(false);

            // The user can start the other song, or press play again, while the
            // metadata is still in flight. If that happened this call is stale
            // and must not yank playback back to its own clip.
            if (activeAudioRef.current !== audio) return;
        }

        try {
            audio.currentTime = target;
        } catch {
            // Safari can still refuse a seek it considers out of range. Playing
            // from wherever the element currently sits beats not playing at all.
        }

        audio.play().catch(() => {
            // A rejected play() (blocked autoplay, a mid-decode error) just
            // means playback didn't start -- the button state below already
            // reflects that via the `pause`/`play` event listeners, so there's
            // nothing further to show.
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
