// lib/songVersion.ts
//
// One operation: swap which *recording* a song entry points to -- title,
// artist, album, artwork and preview -- without disturbing the entry's
// identity. This exists for a tournament organizer who discovers mid-vote
// that "Let It Go (Live)" was the wrong take and wants "Let It Go (Movie
// Version)" instead, but can't remove or re-add the song without invalidating
// every vote already cast against it.
//
// This file deliberately knows nothing about either ranking engine
// (lib/ranking.ts / lib/swiss.ts) and never imports from them: a version
// swap only ever touches `Tournament.songs`, never `Tournament.votes`, so
// there is nothing here for either engine's replay logic to react to. Every
// past `Vote.winnerId` and every pairing id either engine has ever generated
// (`m12:<a>:<b>`, `p2`, `s3-2`, ...) points at `Song.id`, never at title,
// artist, or previewUrl -- see the doc comment on `Song.id` in lib/types.ts.
// That is the whole safety argument, and it is proven directly (not just
// asserted) in scripts/verify-ranking.ts's "Version swap invariant" section:
// play a tournament partway, swap a song's recording keeping its id, and
// assert the standings, matchup count and next pairing come out byte-for-
// byte identical to what they were before the swap.

import type { SearchResult, Song, Tournament } from "./types";

/**
 * Returns a copy of `song` with its recording replaced by `version` -- an
 * iTunes search result the user picked, whether from the "Change version"
 * panel mid-tournament (see `swapSongVersion` below) or from
 * PreflightCheck's pre-tournament "replace this unmatched song" flow, which
 * calls this directly since it already holds a plain `Song[]`, not a
 * `Tournament`.
 *
 * `id` is the ONLY field carried over from `song` rather than taken from
 * `version` -- deliberately spelled out below rather than left to a `{
 * ...song, ...version }` spread, because a spread would silently take
 * `version`'s shape instead (`SearchResult` has no `id` field at all, so
 * that particular spread would actually still keep the old `id` by omission
 * -- but only by accident of which type happens to lack the field, which is
 * exactly the kind of thing a future edit could get wrong without noticing).
 * Being explicit here is what makes "id never changes" true by construction
 * instead of by a spread ordering nobody is likely to re-check.
 */
export function applyVersion(song: Song, version: SearchResult): Song {
    return {
        id: song.id,
        title: version.title,
        artist: version.artist,
        album: version.album,
        artworkUrl: version.artworkUrl,
        previewUrl: version.previewUrl,
        previewSeconds: version.previewSeconds,
        // Same rule NewTournament.tsx's draftToSong uses when a song is
        // first added: a missing preview is a known, user-facing state, not
        // a blank left for ClipPlayer to puzzle over.
        previewNote: version.previewUrl ? null : "No preview available for this track.",
        itunesId: version.itunesId,
    };
}

/**
 * Replaces the recording behind `songId` in `tournament` with `version`,
 * keeping `id` (via `applyVersion`) so every past vote against this entry
 * stays valid -- see this file's header for the full argument.
 *
 * Touches `songs` and nothing else: `votes` is passed through by reference,
 * unchanged, which is exactly why undo (`votes.slice(0, -1)`) and the vote
 * log keep working across a swap without any special-casing -- there is
 * nothing about them for this function to have broken in the first place.
 *
 * A no-op (returns `tournament` unchanged, same reference) if `songId` isn't
 * actually in this tournament -- defensive against a stale reference from a
 * "Change version" panel left open across a tournament reset elsewhere in
 * the tab.
 */
export function swapSongVersion(tournament: Tournament, songId: string, version: SearchResult): Tournament {
    const index = tournament.songs.findIndex((s) => s.id === songId);
    if (index === -1) return tournament;

    const songs = tournament.songs.slice();
    songs[index] = applyVersion(songs[index], version);

    return { ...tournament, songs, updatedAt: new Date().toISOString() };
}
