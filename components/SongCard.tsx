"use client";

import { forwardRef } from "react";
import type { Song, ClipSeconds } from "@/lib/types";
import SongArt from "./SongArt";
import ClipPlayer, { type ClipPlayerHandle } from "./ClipPlayer";

interface Props {
    song: Song;
    side: "A" | "B";
    clipSeconds: ClipSeconds;
    activeAudioRef: React.MutableRefObject<HTMLAudioElement | null>;
    onVote: () => void;
    disabled?: boolean;
    rematch?: boolean;
}

const SongCard = forwardRef<ClipPlayerHandle, Props>(function SongCard(
    { song, side, clipSeconds, activeAudioRef, onVote, disabled, rematch },
    ref
) {
    return (
        <div className="card flex flex-col gap-4 p-4 sm:p-5">
            <div className="flex items-center gap-3">
                <SongArt title={song.title} artworkUrl={song.artworkUrl} size={72} />
                <div className="min-w-0">
                    <span className="kbd mb-1 inline-block">{side}</span>
                    <h3 className="truncate text-base font-bold sm:text-lg" title={song.title}>
                        {song.title}
                    </h3>
                    <p className="truncate text-sm text-fg-muted" title={song.artist}>
                        {song.artist || "Unknown artist"}
                    </p>
                </div>
            </div>

            <ClipPlayer
                ref={ref}
                previewUrl={song.previewUrl}
                previewSeconds={song.previewSeconds}
                previewNote={song.previewNote}
                clipSeconds={clipSeconds}
                activeAudioRef={activeAudioRef}
                label={`Song ${side}`}
            />

            {rematch && (
                <p className="rounded-md bg-bg-soft-2 px-2 py-1 text-center text-[11px] text-fg-muted">
                    These two have already played — no rematch-free pairing was left this round.
                </p>
            )}

            <button type="button" onClick={onVote} disabled={disabled} className="btn-primary w-full">
                Pick {song.title}
            </button>
        </div>
    );
});

export default SongCard;
