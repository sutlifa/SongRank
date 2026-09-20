import type postgres from "postgres";
import { sql } from "./db";
import type { Song, Vote, ClipSeconds, RankingDepth, TournamentFormat } from "./types";
import { deriveTournament } from "./tournamentEngine";
import { encryptToken, decryptToken } from "./spotifyAuth";
import type { MatchConfidence } from "./parse";

/**
 * Tournament persistence for signed-in users.
 *
 * The owner's userId is always in the WHERE clause and always comes from the
 * server-side session (see lib/auth-guard.ts), never from a request body --
 * the same rule the MTG app's lib/saved.ts follows, for the same reason: a
 * row that "doesn't exist" for the wrong caller is what keeps one user's
 * history from leaking into another's.
 */

export type Visibility = "private" | "public";

/** What `saveTournament` did, for callers that need to act on a first save --
 * see the notification hook in lib/tournamentSave.ts. */
export interface SaveResult {
    /** True only when this call created the row, not on any later autosave. */
    inserted: boolean;
    /** The source ranking actually stored, after the public/undeleted check. */
    sourceTournamentId: string | null;
    /**
     * Set when the save was REFUSED because it would have thrown away votes
     * the database already had -- see UNDO_SLACK. Carries what is stored, so
     * the caller can tell the client how far behind it is instead of failing
     * blind. `inserted` is false and nothing was written.
     */
    refused?: { storedVotes: number; incomingVotes: number };
}

/**
 * How many votes a save is allowed to REMOVE from what the database already
 * has for a ranking.
 *
 * Not zero, because undo is a real feature: `votes.slice(0, -1)` is exactly
 * what it does (see lib/types.ts), so a legitimate save is sometimes one or
 * two votes shorter than the last one. Small, because the disaster this
 * exists to prevent is a device pushing a STALE copy over a fresher one --
 * which is not a couple of votes, it is hundreds.
 *
 * This guard was written after a ranking lost roughly three hundred votes:
 * a browser holding an old local copy opened the ranking, and the autosave
 * pushed that copy over the finished one on the server. Nothing in the
 * request looked wrong, which is the point -- a save that discards a third
 * of someone's work should have to be more than an ordinary PUT, and until
 * this clause existed it wasn't.
 *
 * Deliberately a count comparison and not a prefix check on the vote log.
 * A prefix check is stricter and would also catch a stale copy that had
 * DIVERGED at the same length, but it means comparing two jsonb arrays
 * element-wise inside an ON CONFLICT predicate that runs on every autosave.
 * The count catches the case that actually destroys work; if divergence at
 * equal length ever turns out to matter, that is a separate, narrower fix.
 */
const UNDO_SLACK = 5;

export interface TournamentSummary {
    id: string;
    name: string;
    clip_seconds: ClipSeconds;
    format: TournamentFormat;
    depth: RankingDepth | null;
    songs: number;
    votes: number;
    updated_at: string;
    /** So the history list can show, and let you change, who can see this. */
    visibility: Visibility;
    /** When this was deleted, for the "recently deleted" list. Null -- and
     * absent from every other query -- for a live ranking. */
    deleted_at?: string | null;
}

export interface TournamentRow {
    id: string;
    name: string;
    clip_seconds: ClipSeconds;
    format: TournamentFormat;
    depth: RankingDepth | null;
    songs: Song[];
    votes: Vote[];
    created_at: string;
    updated_at: string;
}

export async function listTournaments(userId: number): Promise<TournamentSummary[]> {
    return sql<TournamentSummary[]>`
        SELECT id,
               name,
               clip_seconds,
               format,
               depth,
               jsonb_array_length(songs) AS songs,
               jsonb_array_length(votes) AS votes,
               updated_at,
               visibility
        FROM tournaments
        WHERE user_id = ${userId} AND deleted_at IS NULL
        ORDER BY updated_at DESC
        LIMIT 200
    `;
}

export async function getTournament(userId: number, id: string): Promise<TournamentRow | null> {
    const rows = await sql<TournamentRow[]>`
        SELECT id, name, clip_seconds, format, depth, songs, votes, created_at, updated_at
        FROM tournaments
        WHERE id = ${id} AND user_id = ${userId} AND deleted_at IS NULL
    `;
    return rows[0] ?? null;
}

/**
 * Creates or overwrites a tournament by id.
 *
 * This is a plain upsert, not an ownership-checked update: `id` is a
 * client-generated UUID (see lib/types.ts's Tournament.id comment), so the
 * only way a save "steals" someone else's row is a UUID collision, which is
 * cryptographically not a real concern. The route layer still scopes every
 * *read* by user_id so a guessed id can't be used to snoop another user's
 * tournament even though the id itself isn't secret.
 */
export async function saveTournament(args: {
    userId: number;
    id: string;
    name: string;
    clipSeconds: ClipSeconds;
    format: TournamentFormat;
    depth: RankingDepth | null;
    songs: Song[];
    votes: Vote[];
    /**
     * The public ranking this one was built from, when it was started as a
     * copy of someone else's list. Only meaningful on the first save; see the
     * subselect below and the ON CONFLICT clause, which deliberately leaves it
     * alone afterwards.
     */
    sourceTournamentId?: string | null;
}): Promise<SaveResult> {
    const rows = await sql<{ inserted: boolean; source_tournament_id: string | null }[]>`
        INSERT INTO tournaments (id, user_id, name, clip_seconds, format, depth, songs, votes, source_tournament_id)
        VALUES (
            ${args.id},
            ${args.userId},
            ${args.name},
            ${args.clipSeconds},
            ${args.format},
            ${args.depth},
            ${sql.json(args.songs as unknown as postgres.JSONValue)},
            ${sql.json(args.votes as unknown as postgres.JSONValue)},
            -- A subselect rather than the raw value, for two reasons at once.
            -- The column is a foreign key, so an id that does not exist would
            -- fail the whole INSERT and turn "I mistyped a link" into a 500.
            -- And the WHERE enforces the actual rule -- you may only credit a
            -- PUBLIC, undeleted ranking as your source -- in the one place it
            -- cannot be forgotten. Anything else, including null, yields null.
            (SELECT src.id FROM tournaments src
              WHERE src.id = ${args.sourceTournamentId ?? null}
                AND src.visibility = 'public'
                AND src.deleted_at IS NULL)
        )
        -- The deleted_at check in the WHERE below sits alongside the
        -- ownership check: a background autosave, from a tab still open on a
        -- ranking that was deleted elsewhere, must not quietly bring it back.
        -- Restoring is an explicit act, not something a stale tab does by
        -- accident. (No backticks in here: this is inside a tagged template,
        -- and one would end the string.)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          clip_seconds = EXCLUDED.clip_seconds,
          format = EXCLUDED.format,
          depth = EXCLUDED.depth,
          songs = EXCLUDED.songs,
          votes = EXCLUDED.votes,
          -- source_tournament_id is deliberately NOT updated. It records how
          -- this ranking began, which cannot change, and every autosave after
          -- the first sends no source at all -- so copying it from EXCLUDED
          -- would wipe the attribution on the very next vote.
          updated_at = now()
        WHERE tournaments.user_id = ${args.userId} AND tournaments.deleted_at IS NULL
          -- The vote-loss guard. An autosave may move a ranking FORWARD by any
          -- amount, and backward only by an undo-sized step; see UNDO_SLACK.
          -- It lives here, in the ON CONFLICT predicate, because this is the
          -- single statement every save in the app goes through -- a check in
          -- the route or the client is one someone can later add a second
          -- caller around.
          AND jsonb_array_length(EXCLUDED.votes) >= jsonb_array_length(tournaments.votes) - ${UNDO_SLACK}
        -- xmax = 0 is true only for a row this statement INSERTed; an UPDATE
        -- taken through ON CONFLICT leaves the id of the superseding
        -- transaction there instead. It is the standard way to tell the two
        -- halves of an upsert apart, and it is what stops every autosave --
        -- which re-runs this same statement on every vote -- from looking like
        -- a brand new ranking.
        RETURNING (xmax = 0) AS inserted, source_tournament_id
    `;

    // No row at all means the WHERE rejected the update. That is now three
    // different things -- someone else's id, a ranking in the bin, or a save
    // that would have discarded votes -- and the last one is worth telling
    // the caller about specifically, so it asks.
    const row = rows[0];
    if (!row) {
        const [existing] = await sql<{ votes: number }[]>`
            SELECT jsonb_array_length(votes) AS votes
            FROM tournaments
            WHERE id = ${args.id} AND user_id = ${args.userId} AND deleted_at IS NULL
        `;
        if (existing && args.votes.length < existing.votes - UNDO_SLACK) {
            console.error(
                `REFUSED SHRINKING SAVE: tournament ${args.id} has ${existing.votes} votes, ` +
                    `save offered ${args.votes.length}`
            );
            return {
                inserted: false,
                sourceTournamentId: null,
                refused: { storedVotes: existing.votes, incomingVotes: args.votes.length },
            };
        }
    }
    return {
        inserted: row?.inserted === true,
        // The STORED source, not the requested one. The subselect above drops
        // anything that isn't a real, public, undeleted ranking, so this is
        // the only value a caller may act on.
        sourceTournamentId: row?.source_tournament_id ?? null,
    };
}

/**
 * Moves a ranking to "recently deleted" -- it stops existing everywhere a
 * ranking is read from, but the row survives so it can be brought back.
 *
 * See `deleted_at` in lib/db/schema.sql for why this isn't a DELETE. Already
 * being deleted is not an error: it leaves the caller in the state they asked
 * for, so the second click of a double-click reports the same success as the
 * first rather than a confusing failure.
 */
export async function softDeleteTournament(userId: number, id: string): Promise<boolean> {
    const rows = await sql<{ id: string }[]>`
        UPDATE tournaments SET deleted_at = now()
        WHERE id = ${id} AND user_id = ${userId} AND deleted_at IS NULL
        RETURNING id
    `;
    return rows.length > 0;
}

/**
 * Brings a deleted ranking back, exactly as it was.
 *
 * Nothing about it changed while it was away -- the songs, the vote log and
 * the visibility are all still in the row -- so this is a single field. Its
 * visibility is restored too: a public ranking that was deleted and restored
 * goes back to being public, which is what its owner last chose.
 */
export async function restoreTournament(userId: number, id: string): Promise<boolean> {
    const rows = await sql<{ id: string }[]>`
        UPDATE tournaments SET deleted_at = NULL
        WHERE id = ${id} AND user_id = ${userId} AND deleted_at IS NOT NULL
        RETURNING id
    `;
    return rows.length > 0;
}

/** The real thing: gone, with nothing to restore from. Only ever reached by an
 * explicit "delete forever", never by the ordinary delete button. */
export async function purgeTournament(userId: number, id: string): Promise<boolean> {
    const rows = await sql<{ id: string }[]>`
        DELETE FROM tournaments WHERE id = ${id} AND user_id = ${userId} RETURNING id
    `;
    return rows.length > 0;
}

/** Everything `userId` has deleted and not yet purged, most recent first. */
export async function listDeletedTournaments(userId: number): Promise<TournamentSummary[]> {
    return sql<TournamentSummary[]>`
        SELECT id, name, clip_seconds, format, depth,
               jsonb_array_length(songs) AS songs,
               jsonb_array_length(votes) AS votes,
               updated_at, visibility, deleted_at
        FROM tournaments
        WHERE user_id = ${userId} AND deleted_at IS NOT NULL
        ORDER BY deleted_at DESC
        LIMIT 100
    `;
}

// ---------------------------------------------------------------------------
// Sharing: public rankings, browsing, copying
// ---------------------------------------------------------------------------

/** A public ranking as the browse page and a profile show it: enough to
 * decide whether to open it, and never the vote log. */
export interface PublicTournamentSummary {
    id: string;
    name: string;
    songs: number;
    votes: number;
    updated_at: string;
    owner_id: number;
    owner_name: string | null;
    /** Their handle, or null if they haven't set one -- see lib/username.ts.
     * Carried so a card can link to /u/<handle> and name who made it without a
     * second query per row. */
    owner_username: string | null;
    owner_image: string | null;
}

/**
 * Flips a ranking between private and public.
 *
 * Scoped by user_id like every other write here, so this can only ever be
 * called on your own ranking -- there is no shape of request that publishes
 * someone else's. Returns false when the row isn't yours (or doesn't exist),
 * which the route reports as a 404 rather than a 403 for the same reason
 * GET does: the answer must not confirm that an id exists.
 */
export async function setTournamentVisibility(
    userId: number,
    id: string,
    visibility: Visibility
): Promise<boolean> {
    const rows = await sql<{ id: string }[]>`
        UPDATE tournaments SET visibility = ${visibility}
        WHERE id = ${id} AND user_id = ${userId}
        RETURNING id
    `;
    return rows.length > 0;
}

export async function getVisibility(userId: number, id: string): Promise<Visibility | null> {
    const rows = await sql<{ visibility: Visibility }[]>`
        SELECT visibility FROM tournaments
        WHERE id = ${id} AND user_id = ${userId} AND deleted_at IS NULL
    `;
    return rows[0]?.visibility ?? null;
}

/** Who owns a ranking, and what it is called -- so the "someone used your
 * list" notice can be addressed to the right person and name the list. Null
 * when there is no such ranking. */
export async function getTournamentOwner(id: string): Promise<{ ownerId: number; name: string } | null> {
    const rows = await sql<{ user_id: number; name: string }[]>`
        SELECT user_id, name FROM tournaments WHERE id = ${id} AND deleted_at IS NULL
    `;
    return rows[0] ? { ownerId: rows[0].user_id, name: rows[0].name } : null;
}

/**
 * A public ranking, readable by anyone -- including a signed-out visitor, and
 * including someone who has no account at all.
 *
 * The `visibility = 'public'` clause is the entire access check and is written
 * into the query rather than applied by a caller afterwards, so there is no
 * version of "forgot to filter" available here. There is no userId parameter
 * on purpose: this function cannot be made to return a private row by passing
 * it the wrong one.
 */
export async function getPublicTournament(id: string): Promise<(TournamentRow & {
    owner_id: number;
    owner_name: string | null;
    owner_username: string | null;
    owner_image: string | null;
    source_tournament_id: string | null;
}) | null> {
    const rows = await sql<(TournamentRow & {
        owner_id: number;
        owner_name: string | null;
        owner_username: string | null;
        owner_image: string | null;
        source_tournament_id: string | null;
    })[]>`
        SELECT t.id, t.name, t.clip_seconds, t.format, t.depth, t.songs, t.votes,
               t.created_at, t.updated_at, t.source_tournament_id,
               u.id AS owner_id, u.name AS owner_name, u.username AS owner_username,
               u.image AS owner_image
        FROM tournaments t
        JOIN users u ON u.id = t.user_id
        WHERE t.id = ${id} AND t.visibility = 'public' AND t.deleted_at IS NULL
    `;
    return rows[0] ?? null;
}

/** Public rankings by one person, newest first. Used on their profile. */
export async function listPublicTournamentsByUser(
    ownerId: number,
    limit = 50
): Promise<PublicTournamentSummary[]> {
    return sql<PublicTournamentSummary[]>`
        SELECT t.id, t.name,
               jsonb_array_length(t.songs) AS songs,
               jsonb_array_length(t.votes) AS votes,
               t.updated_at,
               u.id AS owner_id, u.name AS owner_name, u.username AS owner_username,
               u.image AS owner_image
        FROM tournaments t
        JOIN users u ON u.id = t.user_id
        WHERE t.user_id = ${ownerId} AND t.visibility = 'public' AND t.deleted_at IS NULL
        ORDER BY t.updated_at DESC
        LIMIT ${limit}
    `;
}

/**
 * The browse feed: every public ranking except the viewer's own, newest first.
 *
 * `viewerId` is excluded because Browse is for finding what other people are
 * doing. Your own rankings are already listed, with their controls, on
 * /my-rankings -- seeing them again filed under "everyone else" reads as a bug
 * every time, and it is the one section they could never correctly belong to.
 *
 * This is a per-viewer exclusion, not a property of the rows: your public
 * rankings still appear for everybody else exactly as before -- under "from
 * people you follow" for anyone following you, and under "everyone else" for
 * anyone who isn't.
 *
 * Friends are not filtered or sorted here. The caller fetches its friend ids
 * once (lib/friends.ts) and splits this list in two, which keeps the SQL one
 * simple query for signed-in and signed-out visitors alike -- and means a
 * signed-out visitor, who has neither a viewer id nor friends to join against,
 * runs exactly the same query rather than a second code path.
 */
export async function listPublicTournaments(
    viewerId: number | null,
    limit = 60
): Promise<PublicTournamentSummary[]> {
    // -1 can never be a SERIAL id, so a signed-out viewer excludes nobody
    // without needing a second version of this query.
    const exclude = viewerId ?? -1;
    return sql<PublicTournamentSummary[]>`
        SELECT t.id, t.name,
               jsonb_array_length(t.songs) AS songs,
               jsonb_array_length(t.votes) AS votes,
               t.updated_at,
               u.id AS owner_id, u.name AS owner_name, u.username AS owner_username,
               u.image AS owner_image
        FROM tournaments t
        JOIN users u ON u.id = t.user_id
        WHERE t.visibility = 'public' AND t.user_id <> ${exclude} AND t.deleted_at IS NULL
        ORDER BY t.updated_at DESC
        LIMIT ${limit}
    `;
}

/**
 * The rankings of `userId`'s that can be compared against `sourceId` -- their
 * own copies of it, plus the original if they own it.
 *
 * Used to turn "compare our picks" into a real link instead of asking someone
 * to go and find the right ranking themselves.
 */
export async function listComparableTournaments(
    userId: number,
    sourceId: string
): Promise<{ id: string; name: string; votes: number }[]> {
    return sql<{ id: string; name: string; votes: number }[]>`
        SELECT id, name, jsonb_array_length(votes) AS votes
        FROM tournaments
        WHERE user_id = ${userId}
          AND (source_tournament_id = ${sourceId} OR id = ${sourceId})
          AND deleted_at IS NULL
        ORDER BY updated_at DESC
    `;
}

/** A ranking readable for comparison: yours, or anyone's public one. Returns
 * null when it is neither, so a compare link can't be used to read a stranger's
 * private ranking by pairing it with one of your own. */
export async function getComparableTournament(
    viewerId: number | null,
    id: string
): Promise<(TournamentRow & { owner_id: number; owner_name: string | null }) | null> {
    const rows = await sql<(TournamentRow & { owner_id: number; owner_name: string | null })[]>`
        SELECT t.id, t.name, t.clip_seconds, t.format, t.depth, t.songs, t.votes,
               t.created_at, t.updated_at,
               u.id AS owner_id, u.name AS owner_name
        FROM tournaments t
        JOIN users u ON u.id = t.user_id
        WHERE t.id = ${id}
          AND (t.visibility = 'public' OR t.user_id = ${viewerId ?? -1})
          AND t.deleted_at IS NULL
    `;
    return rows[0] ?? null;
}

/** One entry of a finished ranking's podium, as the rankings list shows it. */
export interface TopCutEntry {
    rank: number;
    title: string;
    artist: string;
}

/**
 * The top few songs of each of `ids`, plus whether each one is genuinely
 * finished.
 *
 * Standings are not stored anywhere -- they are derived by replaying the vote
 * log (see lib/types.ts on why that is the design, not an oversight) -- so
 * there is no cheaper way to learn a ranking's podium than to fetch its songs
 * and votes and replay them. That is why this is a SECOND query rather than
 * more columns on `listTournaments`: that one runs for up to 200 rankings and
 * reads none of the jsonb, and it should stay that way. This one reads all of
 * it, so the caller passes a short list of ids and nothing else pays for it.
 *
 * `complete` rides along because this function has already done the expensive
 * part. For the ids it is given, the caller gets the REAL status rather than
 * `looksComplete`'s estimate, and a ranking the estimate misjudged lands under
 * the right heading anyway.
 */
export async function getTopCuts(
    userId: number,
    ids: string[],
    size = 3
): Promise<Map<string, { complete: boolean; top: TopCutEntry[] }>> {
    const out = new Map<string, { complete: boolean; top: TopCutEntry[] }>();
    if (ids.length === 0) return out;

    const rows = await sql<
        { id: string; format: TournamentFormat; depth: RankingDepth | null; songs: Song[]; votes: Vote[] }[]
    >`
        SELECT id, format, depth, songs, votes
        FROM tournaments
        WHERE user_id = ${userId} AND deleted_at IS NULL AND id = ANY(${ids})
    `;

    for (const row of rows) {
        // Enough of a Tournament for the engines, which only ever read the
        // fields below. The rest (name, timestamps, clip length) has no effect
        // on standings, so it isn't fetched.
        const derived = deriveTournament({
            id: row.id,
            name: "",
            createdAt: "",
            updatedAt: "",
            clipSeconds: 30,
            format: row.format,
            depth: row.depth ?? undefined,
            songs: row.songs,
            votes: row.votes,
        });
        const byId = new Map(row.songs.map((s) => [s.id, s]));
        out.set(row.id, {
            complete: derived.status === "complete",
            top: derived.standings.slice(0, size).flatMap((standing) => {
                const song = byId.get(standing.songId);
                // A standing whose song is missing from the list would mean a
                // corrupted row; drop it rather than render "undefined".
                return song ? [{ rank: standing.rank, title: song.title, artist: song.artist }] : [];
            }),
        });
    }
    return out;
}

/** One person's stored Spotify authorisation, tokens already decrypted. */
export interface SpotifyAccount {
    spotifyUserId: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
}

/**
 * Stores (or replaces) someone's Spotify authorisation.
 *
 * Tokens are encrypted here rather than by the caller, so there is exactly one
 * place that decides they get encrypted at all -- a second caller writing this
 * table cannot forget. See lib/spotifyAuth.ts for why they are encrypted on
 * top of Neon's at-rest encryption.
 */
export async function saveSpotifyAccount(
    userId: number,
    account: { spotifyUserId: string; accessToken: string; refreshToken: string; expiresAt: Date }
): Promise<void> {
    await sql`
        INSERT INTO spotify_accounts (user_id, spotify_user_id, access_token_enc, refresh_token_enc, expires_at)
        VALUES (
            ${userId},
            ${account.spotifyUserId},
            ${encryptToken(account.accessToken)},
            ${encryptToken(account.refreshToken)},
            ${account.expiresAt}
        )
        ON CONFLICT (user_id) DO UPDATE SET
          spotify_user_id   = EXCLUDED.spotify_user_id,
          access_token_enc  = EXCLUDED.access_token_enc,
          refresh_token_enc = EXCLUDED.refresh_token_enc,
          expires_at        = EXCLUDED.expires_at,
          updated_at        = now()
    `;
}

/**
 * Updates just the access token after a refresh.
 *
 * Separate from `saveSpotifyAccount` because Spotify only sometimes returns a
 * new refresh token, and the old one stays valid when it doesn't. Overwriting
 * it with an absent value would revoke this person's authorisation on a
 * routine refresh, which they would experience as being randomly logged out of
 * a feature they never touched.
 */
export async function updateSpotifyAccessToken(
    userId: number,
    accessToken: string,
    expiresAt: Date,
    refreshToken?: string
): Promise<void> {
    if (refreshToken) {
        await sql`
            UPDATE spotify_accounts
               SET access_token_enc = ${encryptToken(accessToken)},
                   refresh_token_enc = ${encryptToken(refreshToken)},
                   expires_at = ${expiresAt},
                   updated_at = now()
             WHERE user_id = ${userId}
        `;
        return;
    }
    await sql`
        UPDATE spotify_accounts
           SET access_token_enc = ${encryptToken(accessToken)},
               expires_at = ${expiresAt},
               updated_at = now()
         WHERE user_id = ${userId}
    `;
}

/**
 * Reads someone's authorisation back, decrypted -- or null.
 *
 * Null also covers "stored, but no longer decryptable", which is what a
 * rotated AUTH_SECRET looks like. Treating that as "not connected" is right:
 * the row is useless, and the person needs to reconnect either way.
 */
export async function getSpotifyAccount(userId: number): Promise<SpotifyAccount | null> {
    const [row] = await sql<
        { spotify_user_id: string; access_token_enc: string; refresh_token_enc: string; expires_at: Date }[]
    >`
        SELECT spotify_user_id, access_token_enc, refresh_token_enc, expires_at
        FROM spotify_accounts
        WHERE user_id = ${userId}
    `;
    if (!row) return null;
    const accessToken = decryptToken(row.access_token_enc);
    const refreshToken = decryptToken(row.refresh_token_enc);
    if (!accessToken || !refreshToken) return null;
    return { spotifyUserId: row.spotify_user_id, accessToken, refreshToken, expiresAt: row.expires_at };
}

export async function deleteSpotifyAccount(userId: number): Promise<void> {
    await sql`DELETE FROM spotify_accounts WHERE user_id = ${userId}`;
}

/** A remembered Spotify answer for one song. `uri` null means a known miss. */
export interface CachedSpotifyMatch {
    titleKey: string;
    artistKey: string;
    uri: string | null;
    title: string | null;
    artist: string | null;
    album: string | null;
    confidence: MatchConfidence;
}

/**
 * How long a remembered MISS is trusted.
 *
 * Hits never expire -- a track that exists keeps existing, and re-checking it
 * spends the one resource this cache exists to protect. A miss is different:
 * Spotify's catalogue really does gain tracks, so "not there" is only true as
 * of when it was asked. Two weeks is long enough to keep a big export cheap
 * and short enough that a newly added song turns up eventually.
 */
const MISS_TTL_DAYS = 14;

/**
 * Looks up remembered answers for a batch of songs.
 *
 * One query for the whole batch rather than one per song: the point of this
 * cache is to make an export cheap, and a per-song round trip to Postgres
 * would just move the cost rather than remove it.
 */
export async function getCachedSpotifyMatches(
    keys: { titleKey: string; artistKey: string }[]
): Promise<Map<string, CachedSpotifyMatch>> {
    const out = new Map<string, CachedSpotifyMatch>();
    if (keys.length === 0) return out;

    const titleKeys = keys.map((k) => k.titleKey);
    const artistKeys = keys.map((k) => k.artistKey);
    const rows = await sql<
        {
            title_key: string;
            artist_key: string;
            track_uri: string | null;
            track_title: string | null;
            track_artist: string | null;
            track_album: string | null;
            confidence: MatchConfidence;
        }[]
    >`
        SELECT title_key, artist_key, track_uri, track_title, track_artist, track_album, confidence
        FROM spotify_track_matches
        WHERE (title_key, artist_key) IN (
            SELECT * FROM unnest(${titleKeys}::text[], ${artistKeys}::text[])
        )
          -- A remembered hit is always good; a remembered miss expires.
          AND (track_uri IS NOT NULL OR checked_at > now() - ${`${MISS_TTL_DAYS} days`}::interval)
    `;
    for (const row of rows) {
        out.set(`${row.title_key}\u0000${row.artist_key}`, {
            titleKey: row.title_key,
            artistKey: row.artist_key,
            uri: row.track_uri,
            title: row.track_title,
            artist: row.track_artist,
            album: row.track_album,
            confidence: row.confidence,
        });
    }
    return out;
}

/**
 * Remembers answers, including misses.
 *
 * Upsert rather than insert-if-absent: a miss that has since become a hit
 * should replace the miss, and re-checking after the TTL should reset the
 * clock. Written in one statement for the same reason the read is one query.
 *
 * DE-DUPLICATED FIRST, and not as a tidiness measure. Postgres refuses an
 * INSERT ... ON CONFLICT DO UPDATE whose own rows collide -- "ON CONFLICT DO
 * UPDATE command cannot affect row a second time" -- and it refuses the WHOLE
 * statement, so one repeat poisons every other answer in the batch. Two songs
 * in one ranking really do land on one key: keys are normalised down to title
 * plus PRIMARY artist, so "Let It Go -- Idina Menzel" and "Let It Go -- Idina
 * Menzel & Cast" are the same row, as is any list that simply names a song
 * twice. Last write wins, which is the freshest answer.
 */
export async function saveCachedSpotifyMatches(matches: CachedSpotifyMatch[]): Promise<void> {
    const unique = new Map<string, CachedSpotifyMatch>();
    for (const m of matches) unique.set(`${m.titleKey}\u0000${m.artistKey}`, m);
    const rows = [...unique.values()];
    if (rows.length === 0) return;
    await sql`
        INSERT INTO spotify_track_matches ${sql(
            rows.map((m) => ({
                title_key: m.titleKey,
                artist_key: m.artistKey,
                track_uri: m.uri,
                track_title: m.title,
                track_artist: m.artist,
                track_album: m.album,
                confidence: m.confidence,
            }))
        )}
        ON CONFLICT (title_key, artist_key) DO UPDATE SET
          track_uri    = EXCLUDED.track_uri,
          track_title  = EXCLUDED.track_title,
          track_artist = EXCLUDED.track_artist,
          track_album  = EXCLUDED.track_album,
          confidence   = EXCLUDED.confidence,
          checked_at   = now()
    `;
}
