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
    /**
     * Set on the card that was just chosen, during the brief pause before the
     * next matchup -- see PICK_PAUSE_MS in TournamentPlayer. Null on both cards
     * the rest of the time; "loser" is the other card during that same pause.
     */
    picked?: "winner" | "loser" | null;
    /** Wired to useTournamentLoader's `changeSongVersion` by the caller (see TournamentPlayer). */
    onChangeVersion: (version: SearchResult) => void;
    /**
     * Wired to useTournamentLoader's `refreshSongPreview`. Offered when a clip
     * fails to play, because Apple moves its preview asset files and the stored
     * link dies while the song, the catalogue entry and the ranking are all
     * fine.
     *
     * This matters more here than on the results screen, where it landed first:
     * a dead preview mid-ranking means being asked to vote on a song you cannot
     * hear. It is NOT a version change -- it repairs the link to the same
     * recording, so every vote already cast stays valid; see refreshSongPreview
     * for the identity check that holds that line.
     */
    onRepairPreview: () => Promise<boolean>;
    disabled?: boolean;
    rematch?: boolean;
}

const SongCard = forwardRef<ClipPlayerHandle, Props>(function SongCard(
    {
        song,
        side,
        clipSeconds,
        activeAudioRef,
        onVote,
        onChangeVersion,
        onRepairPreview,
        disabled,
        rematch,
        picked = null,
    },
    ref
) {
    // `min-w-0` on the root because this is a grid item, and a grid item's
    // default `min-width: auto` refuses to shrink below its content's
    // min-content width. One long unbreakable title was therefore sizing the
    // whole track wider than the phone viewport and putting a horizontal
    // scrollbar on the matchup screen.
    return (
        // `h-full` so the card fills the grid row rather than just its own
        // content. A grid item stretches by default, but the CARD is the item
        // only because nothing else sits between -- being explicit is what lets
        // `mt-auto` on the footer below have a bottom to push against.
        //
        // The picked/loser states are the visible half of the pause after a
        // vote: the chosen card lifts and rings, the other recedes. Both are
        // transitions rather than keyframes so an interrupted one (a fast
        // second pick, an undo) unwinds from wherever it got to instead of
        // snapping.
        <div
            className={`card flex h-full min-w-0 flex-col gap-4 p-4 transition-[transform,opacity,box-shadow] duration-200 sm:p-5 ${
                picked === "winner" ? "scale-[1.02] ring-2 ring-accent" : ""
            } ${picked === "loser" ? "scale-[0.98] opacity-45" : ""}`}
        >
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
                    {/* A reserved minimum height for the title block.
                        Without it the two cards' clip players and Pick buttons
                        sat at different heights whenever one title wrapped and
                        the other didn't -- the grid stretched the boxes to
                        match, but their CONTENTS still started from the top and
                        drifted apart. Two lines of title plus one of artist is
                        the common case, so reserving it makes the usual pair
                        line up exactly and the rare three-line title the only
                        one that pushes anything. */}
                    <div className="min-w-0 sm:min-h-[4.75rem]">
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
                onRepairPreview={onRepairPreview}
            />

            {/* `mt-auto` is what actually fixes the misaligned buttons. The
                two cards were already the same HEIGHT -- the grid saw to that
                -- but their contents flowed from the top, so a wrapped title on
                one side pushed its Pick button lower than the other's, and the
                thing you are aiming at moved depending on the song. Anchoring
                the footer to the bottom of the card puts both buttons on the
                same line whatever the titles do. */}
            <div className="mt-auto flex flex-col gap-4">
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
                    <span className="line-clamp-1 break-all">
                        {picked === "winner" ? `✓ Picked ${song.title}` : `Pick ${song.title}`}
                    </span>
                </button>
            </div>
        </div>
    );
});

export default SongCard;
