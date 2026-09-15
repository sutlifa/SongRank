// lib/fixtures.ts
//
// A deterministic, offline stand-in for the iTunes Search API, gated behind
// `SONGRANK_PREVIEW_FIXTURES=1` (server-side only -- see lib/itunes.ts).
//
// It exists purely for testing where the network is closed: this sandbox's
// proxy blocks itunes.apple.com outright (verified: CONNECT to it returns
// 403), so nobody testing SongRank in an environment like this one can ever
// reach a real preview clip, even though production can. Without a fixture
// path, that means "search for a song and hear it" -- the whole point of the
// app -- could never actually be exercised end to end before shipping.
//
// Each fixture song gets a distinct tone (frequency + waveform), synthesized
// on request by /api/preview/tone (see that route for why: a server-side WAV
// generator instead of committing audio assets). Different tones per song
// mean a tester can tell "song A" from "song B" by ear alone, which is the
// actual thing that needs verifying -- that clip playback, the 15s-of-30s
// window, and the A/B switching logic all work -- not just that *a* sound
// plays.
//
// This module is dead weight in production: `SONGRANK_PREVIEW_FIXTURES` is
// never set there, so lib/itunes.ts never imports from here on that path.

import type { SearchResult } from "./types";

interface FixtureSong {
    id: string;
    title: string;
    artist: string;
    album: string;
    /** Hz. Spread widely so adjacent fixtures are easy to tell apart by ear. */
    freq: number;
    wave: "sine" | "square" | "triangle";
}

/**
 * 16 fixture songs -- enough to seed a real Swiss bracket (plannedRounds(16)
 * = 4 rounds) without repeating a tone. Titles/artists are plainly fake so
 * nobody mistakes fixture data for a real search result.
 */
export const FIXTURE_SONGS: FixtureSong[] = [
    { id: "fx-1", title: "Amber Static", artist: "The Faux Tones", album: "Test Pressing", freq: 220, wave: "sine" },
    { id: "fx-2", title: "Borrowed Neon", artist: "The Faux Tones", album: "Test Pressing", freq: 246.94, wave: "sine" },
    { id: "fx-3", title: "Coastline Reruns", artist: "Sandbox Radio", album: "Offline Sessions", freq: 261.63, wave: "square" },
    { id: "fx-4", title: "Dial Tone Serenade", artist: "Sandbox Radio", album: "Offline Sessions", freq: 293.66, wave: "square" },
    { id: "fx-5", title: "Even Odds", artist: "Placeholder Kids", album: "Draft Cuts", freq: 329.63, wave: "triangle" },
    { id: "fx-6", title: "False Start, Again", artist: "Placeholder Kids", album: "Draft Cuts", freq: 349.23, wave: "triangle" },
    { id: "fx-7", title: "Glass Half Synthetic", artist: "Mock Data Trio", album: "No Network", freq: 392.0, wave: "sine" },
    { id: "fx-8", title: "Half-Life Chorus", artist: "Mock Data Trio", album: "No Network", freq: 415.3, wave: "sine" },
    { id: "fx-9", title: "Idle Loop", artist: "The Faux Tones", album: "Test Pressing", freq: 440.0, wave: "square" },
    { id: "fx-10", title: "Just a Fixture", artist: "Sandbox Radio", album: "Offline Sessions", freq: 466.16, wave: "square" },
    { id: "fx-11", title: "Kept in Cache", artist: "Placeholder Kids", album: "Draft Cuts", freq: 493.88, wave: "triangle" },
    { id: "fx-12", title: "Local Only", artist: "Mock Data Trio", album: "No Network", freq: 523.25, wave: "triangle" },
    { id: "fx-13", title: "Mirror, No Signal", artist: "The Faux Tones", album: "Test Pressing", freq: 554.37, wave: "sine" },
    { id: "fx-14", title: "No Preview Blues", artist: "Sandbox Radio", album: "Offline Sessions", freq: 587.33, wave: "sine" },
    { id: "fx-15", title: "Offline Anthem", artist: "Placeholder Kids", album: "Draft Cuts", freq: 622.25, wave: "square" },
    { id: "fx-16", title: "Placeholder Sunrise", artist: "Mock Data Trio", album: "No Network", freq: 659.25, wave: "triangle" },
];

function toSearchResult(song: FixtureSong): SearchResult {
    return {
        title: song.title,
        artist: song.artist,
        album: song.album,
        // No artwork asset is shipped or fetched -- the UI's initials
        // placeholder (see components/SongArt.tsx) covers this case for both
        // fixtures and the real "iTunes had no artwork" outcome, so there is
        // nothing fixture-specific to fake here.
        artworkUrl: null,
        previewUrl: `/api/preview/tone?freq=${song.freq}&wave=${song.wave}&id=${song.id}`,
        previewSeconds: 30,
        itunesId: null,
    };
}

/** Fixture stand-in for a GET /api/songs/search?term=... call. */
export function fixtureSearch(term: string): SearchResult[] {
    const q = term.trim().toLowerCase();
    if (!q) return FIXTURE_SONGS.slice(0, 8).map(toSearchResult);
    return FIXTURE_SONGS.filter(
        (s) => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q)
    ).map(toSearchResult);
}

/**
 * Fixture stand-in for /api/songs/resolve: matches a pasted or search-added
 * song to a fixture by title, falling back to a cyclic assignment by string
 * hash so *every* song in a pasted list gets a distinct, stable tone rather
 * than only the ones that happen to match a fixture title verbatim.
 */
export function fixtureResolve(title: string, artist: string): SearchResult {
    const exact = FIXTURE_SONGS.find(
        (s) => s.title.toLowerCase() === title.trim().toLowerCase()
    );
    if (exact) return toSearchResult(exact);

    let hash = 0;
    const key = `${title}|${artist}`;
    for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    return toSearchResult(FIXTURE_SONGS[hash % FIXTURE_SONGS.length]);
}
