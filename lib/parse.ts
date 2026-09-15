// lib/parse.ts
//
// Turns pasted, freeform text into a list of `ParsedSong`s. Pure and
// synchronous -- no fetch, no DOM -- so it can be unit tested and reused by
// both the /new page and, if it's ever needed, a server route.
//
// The one thing this file refuses to do is guess silently. "Artist - Title"
// and "Title - Artist" are the same string shape, and there is no reliable
// way to tell them apart from the text alone (band names and song titles are
// both just words). So every dash/en-dash/em-dash-separated line is parsed
// to a best guess *and* flagged `ambiguous: true`, and the caller (the
// review table on /new) is expected to show those rows for a human to
// confirm or swap before the tournament starts. Silently guessing wrong for
// a quarter of a pasted list is worse than asking once, up front.

import type { ParsedSong, ParseResult } from "./types";
import { MAX_SONGS } from "./swiss";

/** Bullet/number prefixes people paste from notes apps and playlists. */
const PREFIX_RE = /^\s*(?:\d+[.)]|[-*•‣▪])\s+/;

/** Matching quote pairs to strip from a whole line before parsing it. */
const QUOTE_PAIRS: [string, string][] = [
    ['"', '"'],
    ["'", "'"],
    ["“", "”"], // “ ”
    ["‘", "’"], // ‘ ’
];

/**
 * Strips a single matching pair of quotes wrapping the *whole* string, if
 * present. Applied both to a whole line up front (a line that's just
 * `"Some Song"` with no separator) and to each individual title/artist piece
 * after splitting (`"Take On Me" by A-ha` shouldn't leave the quote marks
 * sitting inside the title).
 */
function stripQuotes(s: string): string {
    const trimmed = s.trim();
    for (const [open, close] of QUOTE_PAIRS) {
        if (trimmed.startsWith(open) && trimmed.endsWith(close) && trimmed.length >= open.length + close.length) {
            return trimmed.slice(open.length, trimmed.length - close.length).trim();
        }
    }
    return trimmed;
}

/** Dash variants that separate "Artist" from "Title" with no way to tell which is which. */
const DASH_RE = /\s+[-–—]\s+/; // hyphen, en dash, em dash, spaced on both sides

const BY_RE = /\s+by\s+/i;

/**
 * Parses one non-empty, prefix-and-quote-stripped line into title/artist.
 *
 * Tries the unambiguous separators first (" by ", the trailing comma form)
 * so a line that happens to contain a dash *inside* the title -- "Hold On -
 * We're Going Home by Drake" -- still resolves correctly rather than
 * splitting on the first dash it finds.
 */
function parseLine(raw: string): ParsedSong {
    const line = stripQuotes(stripPrefix(raw));

    // "Title by Artist" -- unambiguous, this word order only ever means one
    // thing in a song credit.
    const byMatch = line.split(BY_RE);
    if (byMatch.length === 2 && byMatch[0].trim() && byMatch[1].trim()) {
        return {
            title: stripQuotes(byMatch[0]),
            artist: stripQuotes(byMatch[1]),
            raw,
            ambiguous: false,
        };
    }

    // "Title, Artist" -- only tried when there's exactly one comma, so a
    // title that itself contains a comma ("Happiness, Tennessee, USA") isn't
    // torn apart by it.
    const commaParts = line.split(",");
    if (commaParts.length === 2 && commaParts[0].trim() && commaParts[1].trim()) {
        return {
            title: stripQuotes(commaParts[0]),
            artist: stripQuotes(commaParts[1]),
            raw,
            ambiguous: false,
        };
    }

    // "Artist - Title" / "Title - Artist" -- genuinely ambiguous. Default to
    // "Artist - Title" (the more common convention in playlist exports and
    // file names) but flag it so the review table asks the human.
    const dashParts = line.split(DASH_RE);
    if (dashParts.length === 2 && dashParts[0].trim() && dashParts[1].trim()) {
        return {
            title: stripQuotes(dashParts[1]),
            artist: stripQuotes(dashParts[0]),
            raw,
            ambiguous: true,
        };
    }

    // No recognized separator: treat the whole line as a title with no known
    // artist, rather than dropping it. The review table lets the artist
    // field be filled in by hand.
    return { title: stripQuotes(line), artist: "", raw, ambiguous: true };
}

function stripPrefix(line: string): string {
    return line.replace(PREFIX_RE, "");
}

export function parseSongList(text: string): ParseResult {
    const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

    const songs: ParsedSong[] = [];
    const seen = new Set<string>();
    let duplicates = 0;
    let truncated = 0;

    for (const line of lines) {
        if (songs.length >= MAX_SONGS) {
            truncated += 1;
            continue;
        }

        const parsed = parseLine(line);
        const key = `${parsed.title.toLowerCase()}|${parsed.artist.toLowerCase()}`;
        if (seen.has(key)) {
            duplicates += 1;
            continue;
        }
        seen.add(key);
        songs.push(parsed);
    }

    return { songs, duplicates, truncated };
}
