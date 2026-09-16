import type postgres from "postgres";
import { sql } from "./db";
import type { Song, Vote, ClipSeconds, RankingDepth, TournamentFormat } from "./types";

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
}): Promise<void> {
    await sql`
        INSERT INTO tournaments (id, user_id, name, clip_seconds, format, depth, songs, votes)
        VALUES (
            ${args.id},
            ${args.userId},
            ${args.name},
            ${args.clipSeconds},
            ${args.format},
            ${args.depth},
            ${sql.json(args.songs as unknown as postgres.JSONValue)},
            ${sql.json(args.votes as unknown as postgres.JSONValue)}
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
          updated_at = now()
        WHERE tournaments.user_id = ${args.userId} AND tournaments.deleted_at IS NULL
    `;
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
 * /history -- seeing them again filed under "everyone else" reads as a bug
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
 * Copies a public ranking's SONG LIST into a new ranking owned by `userId`.
 *
 * ## A copy inherits the songs and nothing else
 *
 * That rule is the whole design, and it is deliberately stricter than the
 * obvious "copy the row and change the owner":
 *
 *   - **The votes stay behind.** The point is to rank the same songs yourself
 *     and then compare, which starting from someone else's answers would
 *     defeat. The new row begins with an empty vote log, exactly like a
 *     freshly built ranking.
 *   - **The depth is the copier's own choice**, passed in, never read from
 *     the source. Inheriting it meant someone who picked Quick for a
 *     throwaway list silently imposed Quick on everyone who copied it, and
 *     the copier was never shown the choice at all -- they went straight from
 *     a button to their first matchup.
 *   - **The format is always the current engine.** A copy is a new ranking. A
 *     source saved before the adaptive engine existed is still replayed as
 *     Swiss for its owner (see TournamentFormat in lib/types.ts), but there is
 *     no reason to start someone new on the old engine in 2026.
 *   - **The clip length is today's default**, not whatever the source was
 *     saved with, for the same reason: the 10/15-second options no longer
 *     exist and a copy should not resurrect one.
 *   - **The copy is private**, whatever the original was. Copying someone's
 *     list is not a decision to publish your own answers.
 *
 * The source is left completely untouched -- this is an INSERT of a new row
 * and nothing else. There is no statement in this function that can write to
 * the ranking being copied.
 *
 * Song ids are carried over verbatim rather than regenerated, which is what
 * makes lib/compare.ts's exact id matching work later. They are only ever
 * meaningful within one ranking, so two rankings sharing them costs nothing.
 */
export async function copyTournament(args: {
    userId: number;
    sourceId: string;
    newId: string;
    name: string;
    depth: RankingDepth;
    clipSeconds: ClipSeconds;
}): Promise<boolean> {
    const rows = await sql<{ id: string }[]>`
        INSERT INTO tournaments
            (id, user_id, name, clip_seconds, format, depth, songs, votes, visibility, source_tournament_id)
        SELECT ${args.newId},
               ${args.userId},
               ${args.name},
               ${args.clipSeconds},
               'adaptive',
               ${args.depth},
               t.songs,
               '[]'::jsonb,
               'private',
               t.id
        FROM tournaments t
        WHERE t.id = ${args.sourceId} AND t.visibility = 'public' AND t.deleted_at IS NULL
        RETURNING id
    `;
    return rows.length > 0;
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
