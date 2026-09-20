// lib/spotify.ts
//
// Exporting a finished ranking to a Spotify playlist. Nothing here reads from
// Spotify for the app's own purposes -- songs, previews and artwork all still
// come from iTunes (see lib/itunes.ts's header for why, including that Spotify
// stopped serving `preview_url` to apps created after Nov 2024). This module
// exists for one direction only: taking an order somebody already decided and
// writing it somewhere they can play it.
//
// ## Why this is easier than the import that was removed
//
// The old Spotify playlist IMPORT was dropped as unfixable, and it is worth
// being clear that this is not the same problem wearing a different hat.
// Import had to work out what an arbitrary pasted line or an editorial
// playlist meant -- unbounded input, and Apple's and Spotify's catalogues
// disagreeing about it. Export starts from metadata this app already resolved
// and stored: an exact title, an exact artist, usually an album, sometimes an
// iTunes track id. Searching a catalogue with `track:"Be Prepared"
// artist:"Jeremy Irons"` is a far better-posed question than guessing.
//
// It is still a matching problem, though, and matching is where the old
// integration hurt people: a silently wrong recording in somebody's playlist
// is worse than a missing one, because nothing tells them. So every match is
// scored and shown before anything is written -- see `matchTracks`, and the
// review step that calls it.
//
// ## Shape of this file
//
// The HTTP is deliberately thin and pushed to the edges; everything that can
// be wrong in an interesting way -- how a query is phrased, how a response is
// read, which candidate wins, how a long list is batched -- is a pure function
// taking plain data. That is not tidiness: this sandbox's proxy blocks
// api.spotify.com exactly as it blocks itunes.apple.com, so the pure half is
// the half that can be tested at all (scripts/verify-spotify.ts), and the
// thin half is what a first real run has to shake out.

import { scoreCandidate } from "./itunes.ts";
import { normalizeForMatch, type MatchConfidence } from "./parse.ts";

const SPOTIFY_API = "https://api.spotify.com/v1";

/** Same reasoning as lib/itunes.ts's: long enough for a slow upstream, short
 * enough that a route never hangs the UI. */
const TIMEOUT_MS = 8000;

/**
 * Spotify answered with something other than an answer -- a 429, a 5xx, a
 * dead socket. Distinct from "searched and found nothing", for exactly the
 * reason lib/itunes.ts spells out at length: collapsing the two reports a
 * rate limit as "this song isn't on Spotify", which is a plausible,
 * permanent-sounding lie about a track the user can see for themselves.
 */
export class SpotifyUnavailableError extends Error {
    /** Longhand, not a parameter property: the verify scripts run under
     * `node --experimental-strip-types`, which rejects that syntax. */
    readonly reason: string;

    constructor(reason: string) {
        super(`Spotify request failed: ${reason}`);
        this.name = "SpotifyUnavailableError";
        this.reason = reason;
    }
}

/** A track as this app cares about it, flattened out of Spotify's shape. */
export interface SpotifyTrack {
    id: string;
    /** `spotify:track:...` -- what the playlist endpoint actually takes. */
    uri: string;
    title: string;
    /** All credited artists, joined. Spotify returns an array; the scorer and
     * the review screen both want one string. */
    artist: string;
    album: string | null;
    durationMs: number | null;
    explicit: boolean;
}

/** What we asked for, what we found, and how sure we are. */
export interface TrackMatch {
    /** Position in the ranking, 1-based -- so the review screen can say "#7". */
    rank: number;
    title: string;
    artist: string;
    match: SpotifyTrack | null;
    confidence: MatchConfidence;
}

// --- pure: phrasing the query ---------------------------------------------

/** Strips the characters Spotify's query parser treats as syntax, so a title
 * containing a quote can't break out of its own field filter. */
function forField(value: string): string {
    return value.replace(/["']/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The search queries to try, in order, for one song.
 *
 * A ladder rather than one query, for the same reason lib/itunes.ts has
 * `searchFallbacks`: the most precise phrasing is also the most brittle.
 *
 *   1. Both field filters. Precise, and the right answer when the metadata is
 *      clean, which after this app's own resolution step it usually is.
 *   2. Title filter only. Rescues a song whose artist string is a long
 *      soundtrack credit ("Carolina Gaitan - La Gaita, Mauro Castillo, ...")
 *      that Spotify files under something shorter.
 *   3. Plain text, no filters at all. Spotify's own relevance ranking, which
 *      handles the cases a structured query gets wrong -- notably a title
 *      whose parenthetical ("(From \"Encanto\")") is part of Spotify's
 *      official name but not of ours, or vice versa.
 *
 * Callers stop at the first rung that returns a confident match; see
 * `matchOne`.
 */
export function searchQueries(title: string, artist: string): string[] {
    const t = forField(title);
    const a = forField(artist);
    const queries: string[] = [];
    if (t && a) queries.push(`track:"${t}" artist:"${a}"`);
    if (t) queries.push(`track:"${t}"`);
    const plain = [t, a].filter(Boolean).join(" ");
    if (plain) queries.push(plain);
    // Dedupe while keeping order: a song with no artist produces the same
    // string twice, and asking Spotify the identical question twice is a
    // wasted round trip against a rate-limited endpoint.
    return [...new Set(queries)];
}

// --- pure: reading the response -------------------------------------------

interface RawTrack {
    id?: string;
    uri?: string;
    name?: string;
    explicit?: boolean;
    duration_ms?: number;
    album?: { name?: string };
    artists?: { name?: string }[];
}

/**
 * One raw search hit, flattened -- or null when it is unusable.
 *
 * Null rather than a partially-filled object: a track with no `uri` cannot be
 * added to a playlist, so carrying it forward only means discovering that
 * later, somewhere less able to say so.
 */
export function toTrack(raw: RawTrack): SpotifyTrack | null {
    if (!raw?.uri || !raw.id || !raw.name) return null;
    const artist = (raw.artists ?? [])
        .map((a) => a?.name)
        .filter((n): n is string => Boolean(n))
        .join(", ");
    return {
        id: raw.id,
        uri: raw.uri,
        title: raw.name,
        artist,
        album: raw.album?.name ?? null,
        durationMs: typeof raw.duration_ms === "number" ? raw.duration_ms : null,
        explicit: raw.explicit === true,
    };
}

// --- pure: choosing a candidate -------------------------------------------

/**
 * The best candidate for `target`, and how confident we are.
 *
 * Scoring is `scoreCandidate` from lib/itunes.ts -- the same function, not a
 * copy. It takes a target and a candidate as `{title, artist}` and knows
 * nothing about where either came from, so the token coverage and
 * misspelling tolerance (lib/fuzzy.ts) that this app already relies on apply
 * here unchanged. Writing a second scorer would mean two sets of matching
 * rules drifting apart, and the one in lib/itunes.ts is the tested one.
 *
 * Ties are broken by ORDER, which is Spotify's own relevance ranking. That is
 * better information than anything this function could invent, and it matters:
 * a popular studio recording and an obscure live version of the same song
 * score identically on title and artist.
 */
export function pickBest(
    target: { title: string; artist: string },
    candidates: SpotifyTrack[]
): { match: SpotifyTrack | null; confidence: MatchConfidence } {
    let best: SpotifyTrack | null = null;
    let bestConfidence: MatchConfidence = "none";
    for (const candidate of candidates) {
        const confidence = scoreCandidate(target, candidate);
        if (confidence === "high") return { match: candidate, confidence };
        if (confidence === "partial" && bestConfidence === "none") {
            best = candidate;
            bestConfidence = "partial";
        }
    }
    return { match: best, confidence: bestConfidence };
}

/**
 * True when a match is good enough to write into a playlist without asking.
 *
 * Only "high". A "partial" is still shown on the review screen and can be
 * accepted deliberately, but it never ships by default -- the whole reason
 * the old integration was not worth keeping is that a plausible-looking wrong
 * recording lands silently and nothing ever tells its owner.
 */
export function isConfident(confidence: MatchConfidence): boolean {
    return confidence === "high";
}

/**
 * True when a candidate's title carries a version qualifier the target's does
 * not -- "Live", "Remix", "Radio Edit", "Karaoke", and friends.
 *
 * Not used to reject anything on its own: plenty of rankings legitimately
 * contain a remix, and the target title says so when they do. It exists so
 * the review screen can flag the specific case that is easy to miss by eye --
 * you asked for a song and got a karaoke version with the same title and the
 * same credited artist, which scores "high" on every text measure there is.
 */
const VERSION_WORDS = /\b(live|remix|remaster(?:ed)?|karaoke|instrumental|acoustic|demo|cover|radio edit|mix)\b/;
export function versionMismatch(target: { title: string }, candidate: { title: string }): boolean {
    const t = normalizeForMatch(target.title);
    const c = normalizeForMatch(candidate.title);
    return VERSION_WORDS.test(c) && !VERSION_WORDS.test(t);
}

// --- pure: batching --------------------------------------------------------

/** Spotify accepts at most 100 track uris per add-to-playlist request. */
export const MAX_URIS_PER_REQUEST = 100;

/**
 * Splits uris into request-sized batches, preserving order.
 *
 * Order is the entire deliverable here -- the playlist IS the ranking -- so
 * these must be sent sequentially, not in parallel. A concurrent send would
 * interleave batches and produce a playlist in roughly, but not exactly, the
 * right order, which is the kind of wrong that is very hard to notice and
 * impossible to explain.
 */
export function batchUris(uris: string[], size = MAX_URIS_PER_REQUEST): string[][] {
    const batches: string[][] = [];
    for (let i = 0; i < uris.length; i += size) batches.push(uris.slice(i, i + size));
    return batches;
}

// --- the thin HTTP half ----------------------------------------------------

/**
 * Searches Spotify. Injectable so everything above can be tested without a
 * network -- and because this sandbox cannot reach api.spotify.com at all.
 */
export type SpotifySearch = (query: string, limit: number) => Promise<SpotifyTrack[]>;

/** How many candidates to consider per query. Enough that a buried studio
 * version is still reachable past a run of live recordings, in the spirit of
 * lib/itunes.ts's RESOLVE_CANDIDATES. */
export const SEARCH_LIMIT = 20;

/** One song, down the ladder, stopping at the first confident answer. */
export async function matchOne(
    target: { title: string; artist: string },
    search: SpotifySearch
): Promise<{ match: SpotifyTrack | null; confidence: MatchConfidence }> {
    let fallback: { match: SpotifyTrack | null; confidence: MatchConfidence } = {
        match: null,
        confidence: "none",
    };
    for (const query of searchQueries(target.title, target.artist)) {
        const candidates = await search(query, SEARCH_LIMIT);
        const picked = pickBest(target, candidates);
        if (picked.confidence === "high") return picked;
        if (picked.confidence === "partial" && fallback.confidence === "none") fallback = picked;
    }
    return fallback;
}

/**
 * How many songs are looked up at once.
 *
 * Matching was originally one song after another, which is fine in a script
 * and hopeless in a serverless function: a 200-song ranking is 200 to 600
 * sequential HTTPS round trips, comfortably past any function timeout, and it
 * presented as "Spotify didn't answer" because the aborted fetch is
 * indistinguishable from an upstream that went quiet.
 *
 * Four rather than "all of them" because the endpoint is rate-limited per
 * application, not per user -- see lib/itunes.ts's UpstreamUnavailableError
 * comment for what a burst at a metered search endpoint did to this app once
 * already. Four is enough to turn minutes into seconds without becoming the
 * next incident.
 */
export const MATCH_CONCURRENCY = 4;

/**
 * How many songs one match request handles.
 *
 * The client walks a ranking in slices of this size so no single request can
 * outlive the function's duration limit, however long the ranking is. 25 at a
 * concurrency of 4 is roughly seven round trips deep -- a couple of seconds --
 * and gives a 200-song ranking eight requests rather than one that never
 * finishes.
 */
export const MATCH_SLICE = 25;

/**
 * Every song in `songs`, in order, looked up a few at a time.
 *
 * ORDER IS PRESERVED regardless of which lookups finish first: results are
 * written to their own index rather than pushed. The playlist is the ranking,
 * so a result array that reflects completion order instead of rank order would
 * silently produce a shuffled playlist -- and it would do it intermittently,
 * depending on which searches happened to be slow.
 *
 * `startRank` offsets the rank numbers, because callers fetch a ranking in
 * slices (see the match route) and a slice starting at song 26 must report
 * ranks 26.. rather than 1...
 */
export async function matchTracks(
    songs: { title: string; artist: string }[],
    search: SpotifySearch,
    options: { concurrency?: number; startRank?: number } = {}
): Promise<TrackMatch[]> {
    const concurrency = Math.max(1, options.concurrency ?? MATCH_CONCURRENCY);
    const startRank = options.startRank ?? 1;
    const out = new Array<TrackMatch>(songs.length);
    let next = 0;

    async function worker(): Promise<void> {
        for (;;) {
            const index = next++;
            if (index >= songs.length) return;
            const song = songs[index];
            const { match, confidence } = await matchOne(song, search);
            out[index] = {
                rank: startRank + index,
                title: song.title,
                artist: song.artist,
                match,
                confidence,
            };
        }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, songs.length) }, worker));
    return out;
}

/** A search backed by the real API, for a caller holding a user access token. */
export function apiSearch(accessToken: string): SpotifySearch {
    return async (query, limit) => {
        const url = `${SPOTIFY_API}/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`;
        let res: Response;
        try {
            res = await fetch(url, {
                headers: { Authorization: `Bearer ${accessToken}` },
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
        } catch (err) {
            throw new SpotifyUnavailableError(err instanceof Error ? err.message : "network error");
        }
        if (res.status === 429 || res.status >= 500) {
            throw new SpotifyUnavailableError(`HTTP ${res.status}`);
        }
        if (!res.ok) return [];
        const body = (await res.json()) as { tracks?: { items?: RawTrack[] } };
        return (body.tracks?.items ?? []).flatMap((raw) => {
            const track = toTrack(raw);
            return track ? [track] : [];
        });
    };
}

// --- writing the playlist --------------------------------------------------

/**
 * A `spotify:track:...` uri, and nothing else.
 *
 * The review step sends back the uris the person accepted, so this is the
 * boundary where client-supplied strings become something posted to somebody's
 * account. Validating the shape is not paranoia about our own UI: the endpoint
 * is reachable directly, and `spotify:playlist:...` or a crafted value has no
 * business in an add-tracks call made on that person's behalf.
 */
const TRACK_URI = /^spotify:track:[A-Za-z0-9]{10,40}$/;
export function isTrackUri(uri: unknown): uri is string {
    return typeof uri === "string" && TRACK_URI.test(uri);
}

/** Drops anything that isn't a track uri, preserving order and dropping
 * duplicates -- Spotify accepts duplicates, but a ranking cannot contain the
 * same song twice, so one arriving means something upstream is wrong and
 * silently writing it twice is not a kindness. */
export function cleanUris(input: unknown[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const value of input) {
        if (!isTrackUri(value) || seen.has(value)) continue;
        seen.add(value);
        out.push(value);
    }
    return out;
}

export interface CreatedPlaylist {
    id: string;
    url: string;
}

/**
 * Creates an empty playlist on someone's account.
 *
 * Private by default and the caller must opt into public, matching how a
 * ranking itself behaves in this app (see `visibility` in lib/db/schema.sql):
 * exporting is about getting a list you can play, not about publishing it, and
 * a feature that quietly posts to somebody's public profile is one they only
 * find out about from a friend.
 */
export async function createPlaylist(
    accessToken: string,
    spotifyUserId: string,
    name: string,
    description: string,
    isPublic = false
): Promise<CreatedPlaylist | null> {
    try {
        const res = await fetch(`${SPOTIFY_API}/users/${encodeURIComponent(spotifyUserId)}/playlists`, {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ name, description, public: isPublic }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) {
            console.error("SPOTIFY CREATE PLAYLIST ERROR:", res.status, await res.text().catch(() => ""));
            return null;
        }
        const data = (await res.json()) as { id?: string; external_urls?: { spotify?: string } };
        if (!data.id) return null;
        return { id: data.id, url: data.external_urls?.spotify ?? `https://open.spotify.com/playlist/${data.id}` };
    } catch (err) {
        console.error("SPOTIFY CREATE PLAYLIST ERROR:", err);
        return null;
    }
}

/**
 * Adds tracks to a playlist, in order.
 *
 * SEQUENTIAL, deliberately. Order is the entire deliverable -- the playlist IS
 * the ranking -- and concurrent batches would interleave into something
 * roughly, but not exactly, right: the kind of wrong that is very hard to spot
 * and impossible to explain afterwards.
 *
 * Returns how many tracks made it. A partial result is reported honestly
 * rather than thrown away, because the playlist already exists at that point
 * and telling someone "it failed" when 180 of their 200 songs are sitting in
 * it would send them looking for a playlist they already have.
 */
export async function addTracks(
    accessToken: string,
    playlistId: string,
    uris: string[]
): Promise<{ added: number; complete: boolean }> {
    let added = 0;
    for (const batch of batchUris(uris)) {
        try {
            const res = await fetch(`${SPOTIFY_API}/playlists/${encodeURIComponent(playlistId)}/tracks`, {
                method: "POST",
                headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
                body: JSON.stringify({ uris: batch }),
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            if (!res.ok) {
                console.error("SPOTIFY ADD TRACKS ERROR:", res.status, await res.text().catch(() => ""));
                return { added, complete: false };
            }
            added += batch.length;
        } catch (err) {
            console.error("SPOTIFY ADD TRACKS ERROR:", err);
            return { added, complete: false };
        }
    }
    return { added, complete: true };
}

/** The description written onto the playlist. Says where it came from, because
 * in six months nobody remembers why a playlist is in that order. */
export function playlistDescription(rankingName: string, songCount: number, matchupCount: number): string {
    return `${rankingName} — ranked on SongRank from ${matchupCount} head-to-head picks across ${songCount} songs.`;
}
