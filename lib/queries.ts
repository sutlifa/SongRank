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
        WHERE user_id = ${userId}
        ORDER BY updated_at DESC
        LIMIT 200
    `;
}

export async function getTournament(userId: number, id: string): Promise<TournamentRow | null> {
    const rows = await sql<TournamentRow[]>`
        SELECT id, name, clip_seconds, format, depth, songs, votes, created_at, updated_at
        FROM tournaments
        WHERE id = ${id} AND user_id = ${userId}
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
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          clip_seconds = EXCLUDED.clip_seconds,
          format = EXCLUDED.format,
          depth = EXCLUDED.depth,
          songs = EXCLUDED.songs,
          votes = EXCLUDED.votes,
          updated_at = now()
        WHERE tournaments.user_id = ${args.userId}
    `;
}

export async function deleteTournament(userId: number, id: string): Promise<boolean> {
    const rows = await sql<{ id: string }[]>`
        DELETE FROM tournaments WHERE id = ${id} AND user_id = ${userId} RETURNING id
    `;
    return rows.length > 0;
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
        SELECT visibility FROM tournaments WHERE id = ${id} AND user_id = ${userId}
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
        WHERE t.id = ${id} AND t.visibility = 'public'
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
        WHERE t.user_id = ${ownerId} AND t.visibility = 'public'
        ORDER BY t.updated_at DESC
        LIMIT ${limit}
    `;
}

/**
 * The browse feed: every public ranking, newest first.
 *
 * Friends are not filtered or sorted here. The caller fetches its friend ids
 * once (lib/friends.ts) and splits this list in two, which keeps the SQL one
 * simple query for signed-in and signed-out visitors alike -- and means a
 * signed-out visitor, who has no friends to join against, runs exactly the
 * same query rather than a second code path.
 */
export async function listPublicTournaments(limit = 60): Promise<PublicTournamentSummary[]> {
    return sql<PublicTournamentSummary[]>`
        SELECT t.id, t.name,
               jsonb_array_length(t.songs) AS songs,
               jsonb_array_length(t.votes) AS votes,
               t.updated_at,
               u.id AS owner_id, u.name AS owner_name, u.username AS owner_username,
               u.image AS owner_image
        FROM tournaments t
        JOIN users u ON u.id = t.user_id
        WHERE t.visibility = 'public'
        ORDER BY t.updated_at DESC
        LIMIT ${limit}
    `;
}

/**
 * Copies a public ranking's SONG LIST into a new ranking owned by `userId`.
 *
 * The votes are deliberately not copied. The whole point is to rank the same
 * songs yourself and then compare, which starting from someone else's answers
 * would defeat. The new row starts with an empty vote log, which is exactly
 * what a freshly built ranking looks like.
 *
 * The source is left completely untouched -- this is an INSERT of a new row
 * and nothing else. There is no statement in this function that can write to
 * the ranking being copied.
 *
 * Song ids are carried over verbatim rather than regenerated, which is what
 * makes lib/compare.ts's exact id matching work later. They are only ever
 * meaningful within one ranking, so two rankings sharing them costs nothing.
 *
 * The copy is private, whatever the original was. Copying someone's list is
 * not a decision to publish your own answers.
 */
export async function copyTournament(args: {
    userId: number;
    sourceId: string;
    newId: string;
    name: string;
}): Promise<boolean> {
    const rows = await sql<{ id: string }[]>`
        INSERT INTO tournaments
            (id, user_id, name, clip_seconds, format, depth, songs, votes, visibility, source_tournament_id)
        SELECT ${args.newId},
               ${args.userId},
               ${args.name},
               t.clip_seconds,
               t.format,
               t.depth,
               t.songs,
               '[]'::jsonb,
               'private',
               t.id
        FROM tournaments t
        WHERE t.id = ${args.sourceId} AND t.visibility = 'public'
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
    `;
    return rows[0] ?? null;
}
