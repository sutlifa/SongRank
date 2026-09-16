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
    // `min-w-0` on the root because this is a grid item, and a grid item's
    // default `min-width: auto` refuses to shrink below its content's
    // min-content width. One long unbreakable title was therefore sizing the
    // whole track wider than the phone viewport and putting a horizontal
    // scrollbar on the matchup screen.
    return (
        <div className="card flex min-w-0 flex-col gap-4 p-4 sm:p-5">
            {/* `min-w-0` on both this row and the text column below it.
                A flex item defaults to min-width:auto, meaning it refuses to
                shrink below its content's intrinsic width -- so a long title
                pushed this row wider than the card, the card wider than the
                viewport, and put a horizontal scrollbar on the whole matchup
                screen at phone width. The inner column had the override
                already; without it here too, the row still refused to give. */}
            <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-3">
                    <SongArt title={song.title} artworkUrl={song.artworkUrl} size={72} />
                    {/* Titles wrap rather than truncate.
                        `truncate` is a single line plus an ellipsis, which on a
                        card this narrow silently ate most of anything longer
                        than a few words -- and a song you cannot read the name
                        of is one you cannot vote on. Real lists are full of
                        long ones ("A Dream Is a Wish Your Heart Makes"), so the
                        title clamps to three lines on a phone and two on wider
                        screens (where each line holds more) -- generous enough
                        to read, still bounded so the two cards stay level.
                        `overflow-wrap:anywhere` -- not `break-words` -- covers the
                        pathological single word (Supercalifragilisticexpialidocious).
                        The difference matters: `break-word` wraps the word but
                        does NOT reduce the element's min-content width, so the
                        grid track still sized itself to the unbroken word and
                        overflowed the viewport. `anywhere` shrinks the intrinsic
                        minimum too, which is what actually lets the card fit. The
                        `title` attributes stay for the rare case longer than
                        even that. */}
                    <div className="min-w-0">
                        <span className="kbd mb-1 inline-block">{side}</span>
                        <h3
                            className="line-clamp-3 text-base font-bold [overflow-wrap:anywhere] sm:line-clamp-2 sm:text-lg"
                            title={song.title}
                        >
                            {song.title}
                        </h3>
                        <p
                            className="line-clamp-2 text-sm text-fg-muted [overflow-wrap:anywhere]"
                            title={song.artist}
                        >
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

            {/* The button keeps a single line on purpose -- it is the vote
                target, so its height must not shift between the two cards as
                titles differ, or the thing you are aiming at moves. The full
                name is one line above and in aria-label, so clipping here
                costs nothing. */}
            <button
                type="button"
                onClick={onVote}
                disabled={disabled}
                className="btn-primary w-full"
                aria-label={`Pick ${song.title}`}
            >
                <span className="line-clamp-1 break-all">Pick {song.title}</span>
            </button>
        </div>
    );
});

export default SongCard;
