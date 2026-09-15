// lib/parse.ts
//
// Turns pasted, freeform text into a list of `ParsedSong`s, and (separately)
// resolves that list against the song catalogue.
//
// This file used to argue that "Artist - Title" and "Title - Artist" are the
// same string shape and therefore unknowable -- true of one line in
// isolation, false of the file as a whole. Three sources of signal fix it,
// in order of power:
//
//   (a) Catalogue lookup. The whole raw line is sent to the iTunes Search
//       API as a search term (see `resolveImportBatch` below) and the top
//       result's own `trackName`/`artistName` are compared back against the
//       line. When both are clearly present in what the user typed, the
//       catalogue's answer replaces our guess outright -- we stop asking
//       "which side is the artist" and let Apple's own metadata say so.
//   (b) Cross-line frequency analysis. In a pasted list the artist side
//       repeats and the title side doesn't: one album, one artist's
//       discography, a festival lineup with a repeated headliner. Every
//       line that uses the same separator is grouped, and the side with
//       fewer distinct values (and at least one real repeat) is taken as
//       the artist for the whole group. This is synchronous, needs no
//       network, and is also what a paste falls back to when iTunes can't
//       be reached.
//   (c) Wider format coverage -- see `buildItems` and `detectTabularHeader`
//       below for the full list (by/colon/comma/pipe/dash/tab, CSV/TSV
//       exports with a header row, numbered prefixes, quoted titles,
//       trailing durations and album names, multi-artist feat./&/x forms).
//
// A single isolated line with an ambiguous separator and no catalogue match
// is still fundamentally unknowable from the text alone -- that part of the
// original reasoning holds. It's just no longer the common case: (a) and (b)
// resolve almost everything a real paste throws at them, and what's left is
// flagged `ambiguous: true` for the review table, same as before.
//
// The pure/synchronous layer (`parseSongList` and everything it calls) has
// no fetch and no DOM, so it's unit-testable and safe to run on every
// keystroke-adjacent event. The catalogue-resolution layer
// (`resolveImportBatch`) is async and takes an injected `SearchFn` rather
// than importing lib/itunes.ts directly, both so it stays testable without a
// network call (see scripts/verify-parse.ts) and so the only thing that ever
// actually calls itunes.apple.com is lib/itunes.ts itself, from the server
// (see that file's header for why).

import type { ParsedSong, ParseResult, SearchResult } from "./types";
// ".ts" written out on this one (but not the type-only import above) because
// this is a *value* import -- node's --experimental-strip-types resolves it
// at runtime and, per tsconfig.json's own comment on `allowImportingTsExtensions`,
// needs the extension literally; a type-only import is elided before
// resolution ever happens, so it doesn't need one. Safe under Next's bundler
// resolution either way.
import { MAX_SONGS } from "./swiss.ts";

/** Bullet/number prefixes people paste from notes apps and playlists: "1. ", "01)", "1 - ", "- ", "• ". */
const PREFIX_RE = /^\s*(?:\d+\s*[.):]\s*|\d+\s+-\s+|[-*•‣▪]\s+)/;

/** Matching quote pairs to strip from a whole line, or from one split-off piece, before parsing it further. */
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

function stripPrefix(line: string): string {
    return line.replace(PREFIX_RE, "");
}

/** A trailing "3:45", "(3:45)" or "[3:45]" duration marker some exports append. */
const TRAILING_DURATION_RE = /\s*[([]?\s*\d{1,2}:[0-5]\d\s*[)\]]?\s*$/;
function stripDuration(line: string): string {
    return line.replace(TRAILING_DURATION_RE, "");
}

/** Leftover separator punctuation exposed at the end of a line once a trailing duration or album is removed. */
function stripTrailingPunct(line: string): string {
    return line.replace(/[\s\-–—|,:]+$/, "").trim();
}

/**
 * Strips a trailing "(Album Name)" / "[Album Name]" group, but only when it
 * sits at the very end of the line and doesn't look like a featured-artist
 * credit -- "(feat. Someone)" is part of the song's identity and stays.
 */
function stripTrailingAlbum(line: string): string {
    const m = line.match(/^(.*?)\s*([([][^()[\]]*[)\]])\s*$/);
    if (!m) return line;
    if (/\b(feat\.?|ft\.?|featuring)\b/i.test(m[2])) return line;
    return m[1].trim();
}

/** Lines that carry no song at all: blanks, share links, decorative rules, disc headers. */
function isJunkLine(line: string): boolean {
    const t = line.trim();
    if (!t) return true;
    if (/^https?:\/\//i.test(t)) return true;
    if (/^[-=_*~.\s]+$/.test(t)) return true;
    if (/^(disc|cd)\s*\d+:?$/i.test(t)) return true;
    return false;
}

const BY_RE = /\s+by\s+/i;
/** Dash variants that separate two fields with no fixed order: hyphen, en dash, em dash, spaced on both sides. */
const DASH_RE = /\s+[-–—]\s+/;

/**
 * "Artist: Title" -- treated as unambiguous (that word order only ever means
 * one thing in a credit), but only when there's exactly one colon. A second
 * one is more likely a subtitle ("Album: Side A: Track One") than a second
 * field boundary, and guessing wrong there is worse than falling through to
 * the separators below.
 */
function splitColon(line: string): [artist: string, title: string] | null {
    const idx = line.indexOf(":");
    if (idx <= 0 || idx >= line.length - 1) return null;
    const left = line.slice(0, idx).trim();
    const right = line.slice(idx + 1).trim();
    if (!left || !right || right.includes(":")) return null;
    return [left, right];
}

// ---------------------------------------------------------------------------
// CSV/TSV export support (Spotify, Apple Music, and anything else that pastes
// a header row followed by one song per line).
// ---------------------------------------------------------------------------

const TITLE_HEADERS = new Set(["title", "track name", "name", "song", "song name", "song title", "track"]);
const ARTIST_HEADERS = new Set(["artist", "artist name(s)", "artist(s)", "artist name", "artists"]);

/** A minimal quoted-CSV splitter: handles fields quoted because they contain a comma, and doubled `""` as an escaped quote. */
function splitCsvLine(line: string): string[] {
    const fields: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"') {
                if (line[i + 1] === '"') {
                    cur += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                cur += ch;
            }
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === ",") {
            fields.push(cur);
            cur = "";
        } else {
            cur += ch;
        }
    }
    fields.push(cur);
    return fields.map((f) => f.trim());
}

interface TabularHeader {
    delimiter: "\t" | ",";
    titleIdx: number;
    artistIdx: number;
}

/** Sniffs the first line of a paste for a recognizable "Title"/"Artist"-shaped header, tab- or comma-delimited. */
function detectTabularHeader(firstLine: string): TabularHeader | null {
    if (firstLine.includes("\t")) {
        const fields = firstLine.split("\t").map((f) => f.trim().toLowerCase());
        const titleIdx = fields.findIndex((f) => TITLE_HEADERS.has(f));
        const artistIdx = fields.findIndex((f) => ARTIST_HEADERS.has(f));
        if (titleIdx !== -1 && artistIdx !== -1) return { delimiter: "\t", titleIdx, artistIdx };
    }
    if (firstLine.includes(",")) {
        const fields = splitCsvLine(firstLine).map((f) => f.toLowerCase());
        const titleIdx = fields.findIndex((f) => TITLE_HEADERS.has(f));
        const artistIdx = fields.findIndex((f) => ARTIST_HEADERS.has(f));
        if (titleIdx !== -1 && artistIdx !== -1) return { delimiter: ",", titleIdx, artistIdx };
    }
    return null;
}

function parseTabularRows(lines: string[], header: TabularHeader): ParsedSong[] {
    const out: ParsedSong[] = [];
    for (const raw of lines) {
        if (isJunkLine(raw)) continue;
        const fields =
            header.delimiter === "\t" ? raw.split("\t").map(stripQuotes) : splitCsvLine(raw).map(stripQuotes);
        const title = fields[header.titleIdx] ?? "";
        const artist = fields[header.artistIdx] ?? "";
        if (!title) continue;
        out.push({ title, artist, raw, ambiguous: false });
    }
    return out;
}

// ---------------------------------------------------------------------------
// The two-way-separator path (dash / pipe / bare-tab paste with no header):
// parse each line to a left/right pair without committing to an orientation,
// then decide artist-vs-title per separator *once, from all the lines that
// used it* -- see `decideOrientation`.
// ---------------------------------------------------------------------------

type PendingCategory = "dash" | "pipe" | "tab";
type Pending = { raw: string; left: string; right: string; category: PendingCategory };
type Item = { kind: "song"; song: ParsedSong } | ({ kind: "pending" } & Pending);

function buildItems(lines: string[]): Item[] {
    const items: Item[] = [];

    for (const raw of lines) {
        if (isJunkLine(raw)) continue;

        let line = stripPrefix(raw);
        line = stripQuotes(line);
        line = stripDuration(line);
        line = stripTrailingPunct(line);
        line = stripTrailingAlbum(line);
        line = stripTrailingPunct(line);
        if (!line) continue;

        // "Title by Artist" -- unambiguous, tried first so a line that
        // happens to contain a dash *inside* the title ("Hold On - We're
        // Going Home by Drake") still resolves correctly rather than
        // splitting on the first dash it finds.
        const byParts = line.split(BY_RE);
        if (byParts.length === 2 && byParts[0].trim() && byParts[1].trim()) {
            items.push({ kind: "song", song: { title: stripQuotes(byParts[0]), artist: stripQuotes(byParts[1]), raw, ambiguous: false } });
            continue;
        }

        const colon = splitColon(line);
        if (colon) {
            items.push({ kind: "song", song: { artist: stripQuotes(colon[0]), title: stripQuotes(colon[1]), raw, ambiguous: false } });
            continue;
        }

        // "Title, Artist" -- only tried when there's exactly one comma, so a
        // title that itself contains a comma ("Happiness, Tennessee, USA")
        // isn't torn apart by it.
        const commaParts = line.split(",");
        if (commaParts.length === 2 && commaParts[0].trim() && commaParts[1].trim()) {
            items.push({ kind: "song", song: { title: stripQuotes(commaParts[0]), artist: stripQuotes(commaParts[1]), raw, ambiguous: false } });
            continue;
        }

        // Tab-separated (Excel/Sheets paste with no header row we recognized).
        if (line.includes("\t")) {
            const parts = line.split("\t").map((p) => stripQuotes(p)).filter((p) => p.length > 0);
            if (parts.length === 2) {
                items.push({ kind: "pending", raw, left: parts[0], right: parts[1], category: "tab" });
                continue;
            }
        }

        if (line.includes("|")) {
            const parts = line.split("|").map((p) => stripQuotes(p));
            if (parts.length === 2 && parts[0] && parts[1]) {
                items.push({ kind: "pending", raw, left: parts[0], right: parts[1], category: "pipe" });
                continue;
            }
        }

        // Genuinely order-ambiguous: resolved per-separator by frequency
        // analysis below, not here.
        const dashParts = line.split(DASH_RE);
        if (dashParts.length === 2 && dashParts[0].trim() && dashParts[1].trim()) {
            items.push({ kind: "pending", raw, left: stripQuotes(dashParts[0]), right: stripQuotes(dashParts[1]), category: "dash" });
            continue;
        }

        // No recognized separator: treat the whole line as a title with no
        // known artist, rather than dropping it. The review table lets the
        // artist field be filled in by hand.
        items.push({ kind: "song", song: { title: stripQuotes(line), artist: "", raw, ambiguous: true } });
    }

    return items;
}

/**
 * The frequency-analysis heart of problem (b): across every line that used
 * this separator, the side that repeats is the artist and the side that
 * doesn't is the title. A group of one carries no such signal and falls back
 * to the old "assume Artist - Title" default, staying flagged for a human to
 * confirm (or for the catalogue lookup in `resolveImportBatch` to settle).
 */
function decideOrientation(group: Pending[]): { artistSide: "left" | "right"; confident: boolean } {
    const left = new Map<string, number>();
    const right = new Map<string, number>();
    for (const it of group) {
        const lk = it.left.toLowerCase();
        const rk = it.right.toLowerCase();
        left.set(lk, (left.get(lk) ?? 0) + 1);
        right.set(rk, (right.get(rk) ?? 0) + 1);
    }
    const leftMax = Math.max(...left.values());
    const rightMax = Math.max(...right.values());

    if (group.length >= 2 && left.size < right.size && leftMax >= 2) {
        return { artistSide: "left", confident: true };
    }
    if (group.length >= 2 && right.size < left.size && rightMax >= 2) {
        return { artistSide: "right", confident: true };
    }
    return { artistSide: "left", confident: false };
}

function resolvePending(items: Item[]): ParsedSong[] {
    const groups = new Map<PendingCategory, Pending[]>();
    for (const it of items) {
        if (it.kind !== "pending") continue;
        const arr = groups.get(it.category);
        if (arr) arr.push(it);
        else groups.set(it.category, [it]);
    }

    const orientation = new Map<PendingCategory, { artistSide: "left" | "right"; confident: boolean }>();
    for (const [category, group] of groups) orientation.set(category, decideOrientation(group));

    return items.map((it) => {
        if (it.kind === "song") return it.song;
        const decision = orientation.get(it.category);
        const artistSide = decision?.artistSide ?? "left";
        const confident = decision?.confident ?? false;
        const [artist, title] = artistSide === "left" ? [it.left, it.right] : [it.right, it.left];
        return { title, artist, raw: it.raw, ambiguous: !confident };
    });
}

export function parseSongList(text: string): ParseResult {
    const nonEmpty = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

    if (nonEmpty.length === 0) return { songs: [], duplicates: 0, truncated: 0 };

    const header = detectTabularHeader(nonEmpty[0]);
    const parsedInOrder: ParsedSong[] = header
        ? parseTabularRows(nonEmpty.slice(1), header)
        : resolvePending(buildItems(nonEmpty));

    const songs: ParsedSong[] = [];
    const seen = new Set<string>();
    let duplicates = 0;
    let truncated = 0;

    for (const parsed of parsedInOrder) {
        if (songs.length >= MAX_SONGS) {
            truncated += 1;
            continue;
        }
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

// ---------------------------------------------------------------------------
// Catalogue resolution (problem 1, part (a)): async, network-backed, and
// deliberately decoupled from any particular transport -- see the file
// header for why `SearchFn` is injected rather than imported.
// ---------------------------------------------------------------------------

export type MatchConfidence = "high" | "partial" | "none";

export interface ResolvedImportSong {
    title: string;
    artist: string;
    raw: string;
    /** False once catalogue lookup confirms the match -- no review row needed. */
    ambiguous: boolean;
    confidence: MatchConfidence;
    /** The catalogue's own answer, when the search returned anything usable. Set at "high" and "partial", null at "none". */
    matched: SearchResult | null;
}

/** Looks up candidates for one search term. Implementations must never throw -- see `resolveOne`, which treats a throw as "no match" anyway, but a well-behaved one (like lib/itunes.ts's `searchSongs`) already degrades to `[]` on its own. */
export type SearchFn = (term: string) => Promise<SearchResult[]>;

/** Common words excluded from token coverage so "The Beatles" vs "Beatles" doesn't read as a mismatch. */
const STOPWORDS = new Set(["the", "a", "an", "and", "of", "&"]);

/** Lowercases, strips diacritics and punctuation, and drops a trailing feat./ft./featuring clause -- for *comparison* only, never applied to a title or artist that gets displayed or saved. */
export function normalizeForMatch(s: string): string {
    return s
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/\b(feat\.?|ft\.?|featuring)\b.*$/, "")
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function tokens(s: string): string[] {
    const normalized = normalizeForMatch(s);
    if (!normalized) return [];
    return normalized.split(" ").filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

function coverage(needle: string[], haystack: Set<string>): number {
    if (needle.length === 0) return 0;
    const found = needle.filter((t) => haystack.has(t)).length;
    return found / needle.length;
}

/**
 * Scores how well an iTunes candidate matches the raw pasted line it was
 * searched with, by token coverage in both directions:
 *   - both track and artist substantially present in the line -> "high"
 *   - only partial overlap -> "partial"
 *   - effectively nothing in common -> "none"
 * This is the heart of problem (a): rather than trust our own guess at which
 * side of a dash is the artist, we ask the catalogue and measure how much of
 * its answer is actually present in what the user typed.
 */
export function scoreMatch(rawLine: string, candidate: { title: string; artist: string }): MatchConfidence {
    const haystack = new Set(tokens(rawLine));
    if (haystack.size === 0) return "none";
    const titleCoverage = coverage(tokens(candidate.title), haystack);
    const artistCoverage = coverage(tokens(candidate.artist), haystack);
    if (titleCoverage >= 0.7 && artistCoverage >= 0.6) return "high";
    if (titleCoverage >= 0.4 || artistCoverage >= 0.4) return "partial";
    return "none";
}

function confidenceRank(c: MatchConfidence): number {
    return c === "high" ? 2 : c === "partial" ? 1 : 0;
}

async function resolveOne(song: ParsedSong, searchFn: SearchFn): Promise<ResolvedImportSong> {
    let candidates: SearchResult[] = [];
    try {
        // The whole raw line, not our own title/artist guess -- see (a) in
        // the file header. Letting the catalogue see exactly what the user
        // pasted is what lets it out-guess our own heuristic.
        candidates = await searchFn(song.raw);
    } catch {
        // Network error, blocked host, bad JSON -- degrade to the heuristic
        // guess below. Never throw: a 250-song paste with the network down
        // must still finish, not hang or blow up the review step.
        candidates = [];
    }

    let best: { candidate: SearchResult; confidence: MatchConfidence } | null = null;
    for (const candidate of candidates) {
        const confidence = scoreMatch(song.raw, candidate);
        if (!best || confidenceRank(confidence) > confidenceRank(best.confidence)) {
            best = { candidate, confidence };
            if (confidence === "high") break; // can't do better than high
        }
    }

    if (!best || best.confidence === "none") {
        return { title: song.title, artist: song.artist, raw: song.raw, ambiguous: song.ambiguous, confidence: "none", matched: null };
    }

    if (best.confidence === "high") {
        // The catalogue's answer replaces our guess outright, and the review
        // flag comes off entirely -- this row needs no human check.
        return {
            title: best.candidate.title,
            artist: best.candidate.artist,
            raw: song.raw,
            ambiguous: false,
            confidence: "high",
            matched: best.candidate,
        };
    }

    // Partial: keep our own guess as the editable starting point (it's at
    // least as likely to be right as a stranger's top search hit) but keep
    // the review flag on and surface the candidate as a hint.
    return { title: song.title, artist: song.artist, raw: song.raw, ambiguous: true, confidence: "partial", matched: best.candidate };
}

/**
 * Resolves a batch of pure-heuristic guesses against the song catalogue with
 * bounded concurrency (mirrors NewTournament's own preview-resolution pass,
 * for the same reason: fire off a handful of requests at once rather than
 * either serializing 250 of them or firing all 250 simultaneously).
 */
export async function resolveImportBatch(
    songs: ParsedSong[],
    searchFn: SearchFn,
    opts: { concurrency?: number; onProgress?: (done: number, total: number) => void } = {}
): Promise<ResolvedImportSong[]> {
    if (songs.length === 0) return [];

    const concurrency = Math.max(1, Math.min(opts.concurrency ?? 6, songs.length));
    const results = new Array<ResolvedImportSong>(songs.length);
    let done = 0;
    let cursor = 0;

    async function worker() {
        for (;;) {
            const index = cursor++;
            if (index >= songs.length) return;
            results[index] = await resolveOne(songs[index], searchFn);
            done += 1;
            opts.onProgress?.(done, songs.length);
        }
    }

    await Promise.all(Array.from({ length: concurrency }, worker));
    return results;
}
