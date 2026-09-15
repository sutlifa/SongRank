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

export interface TournamentSummary {
    id: string;
    name: string;
    clip_seconds: ClipSeconds;
    format: TournamentFormat;
    depth: RankingDepth | null;
    songs: number;
    votes: number;
    updated_at: string;
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
               updated_at
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
