"use client";

import { forwardRef } from "react";
import type { Song, ClipSeconds, SearchResult } from "@/lib/types";
import SongArt from "./SongArt";
import ClipPlayer, { type ClipPlayerHandle } from "./ClipPlayer";
import ChangeVersionControl from "./ChangeVersionControl";

interface Props {
    song: Song;
    side: "A" | "B";
    clipSeconds: ClipSeconds;
    activeAudioRef: React.MutableRefObject<HTMLAudioElement | null>;
    onVote: () => void;
    /** Wired to useTournamentLoader's `changeSongVersion` by the caller (see TournamentPlayer). */
    onChangeVersion: (version: SearchResult) => void;
    disabled?: boolean;
    rematch?: boolean;
}

const SongCard = forwardRef<ClipPlayerHandle, Props>(function SongCard(
    { song, side, clipSeconds, activeAudioRef, onVote, onChangeVersion, disabled, rematch },
    ref
) {
    return (
        <div className="card flex flex-col gap-4 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-3">
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
                {/* Top corner, away from the big "Pick" button below -- see
                    ChangeVersionControl's own header for why it's this small
                    and this far from the vote action. */}
                <ChangeVersionControl
                    song={song}
                    clipSeconds={clipSeconds}
                    activeAudioRef={activeAudioRef}
                    onPick={onChangeVersion}
                />
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
                    These two have already played once — every other pairing worth showing you has too.
                </p>
            )}

            <button type="button" onClick={onVote} disabled={disabled} className="btn-primary w-full">
                Pick {song.title}
            </button>
        </div>
    );
});

export default SongCard;
