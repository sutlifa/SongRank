// lib/friends.ts
//
// One-way friendships -- see the `friends` table's own comment in
// lib/db/schema.sql for why there is no request/accept handshake: friendship
// gates nothing here, it only decides whose public rankings float to the top
// of your browse page.
//
// Everything in this file is scoped to a `userId` that came from the session
// (see lib/auth-guard.ts), never from a request body. Same rule as
// lib/queries.ts, for the same reason.

import { sql } from "./db";
import { notifyFollow } from "./notifications";
import type { PersonSummary } from "./people";

interface FriendRow {
    id: number;
    name: string | null;
    username: string | null;
    image: string | null;
    public_rankings: string;
}

/** Everyone `userId` has added, most recently active first. */
export async function listFriends(userId: number): Promise<PersonSummary[]> {
    const rows = await sql<FriendRow[]>`
        SELECT u.id, u.name, u.username, u.image,
               (SELECT COUNT(*) FROM tournaments t
                 WHERE t.user_id = u.id AND t.visibility = 'public'
                         AND t.deleted_at IS NULL) AS public_rankings
        FROM friends f
        JOIN users u ON u.id = f.friend_id
        WHERE f.user_id = ${userId}
        ORDER BY lower(coalesce(u.username, u.name))
    `;
    return rows.map((row) => ({
        id: row.id,
        name: row.name,
        username: row.username,
        image: row.image,
        publicRankings: Number(row.public_rankings),
    }));
}

/**
 * Everyone who has added `userId` -- the other direction of the same table.
 *
 * Visible on a profile, like the following list. Following is a public act
 * here: it is how you say "show me this person's rankings first", it gives
 * access to nothing, and a follower list that were somehow secret would be an
 * odd thing to maintain when every row of it can be inferred from the other
 * side anyway.
 */
export async function listFollowers(userId: number): Promise<PersonSummary[]> {
    const rows = await sql<FriendRow[]>`
        SELECT u.id, u.name, u.username, u.image,
               (SELECT COUNT(*) FROM tournaments t
                 WHERE t.user_id = u.id AND t.visibility = 'public'
                         AND t.deleted_at IS NULL) AS public_rankings
        FROM friends f
        JOIN users u ON u.id = f.user_id
        WHERE f.friend_id = ${userId}
        ORDER BY lower(coalesce(u.username, u.name))
    `;
    return rows.map((row) => ({
        id: row.id,
        name: row.name,
        username: row.username,
        image: row.image,
        publicRankings: Number(row.public_rankings),
    }));
}

/**
 * How many people someone follows, and how many follow them.
 *
 * One round trip for both, because a profile always wants the pair and two
 * queries to count two columns of the same small table is wasteful in the
 * literal sense -- the planner reads it once either way.
 */
export async function followCounts(userId: number): Promise<{ following: number; followers: number }> {
    const rows = await sql<{ following: string; followers: string }[]>`
        SELECT
          COUNT(*) FILTER (WHERE user_id = ${userId})   AS following,
          COUNT(*) FILTER (WHERE friend_id = ${userId}) AS followers
        FROM friends
        WHERE user_id = ${userId} OR friend_id = ${userId}
    `;
    // COUNT is a bigint, which postgres.js hands over as a string rather than
    // silently losing precision.
    return { following: Number(rows[0]?.following ?? 0), followers: Number(rows[0]?.followers ?? 0) };
}

/** Just the ids, for deciding which cards to badge as a friend's. */
export async function friendIds(userId: number): Promise<Set<number>> {
    const rows = await sql<{ friend_id: number }[]>`
        SELECT friend_id FROM friends WHERE user_id = ${userId}
    `;
    return new Set(rows.map((r) => r.friend_id));
}

export async function isFriend(userId: number, friendId: number): Promise<boolean> {
    const rows = await sql<{ friend_id: number }[]>`
        SELECT friend_id FROM friends WHERE user_id = ${userId} AND friend_id = ${friendId}
    `;
    return rows.length > 0;
}

/**
 * Adds a friend. Idempotent -- adding someone twice is a no-op rather than an
 * error, because the only way to hit it is a double-click.
 *
 * Returns false when the target doesn't exist or is the caller themselves.
 * Self-friending is also blocked by a CHECK constraint on the table; the
 * check here is so the route can answer with a sentence instead of a 500.
 */
export async function addFriend(userId: number, friendId: number): Promise<boolean> {
    if (userId === friendId) return false;

    const exists = await sql<{ id: number }[]>`SELECT id FROM users WHERE id = ${friendId}`;
    if (exists.length === 0) return false;

    await sql`
        INSERT INTO friends (user_id, friend_id)
        VALUES (${userId}, ${friendId})
        ON CONFLICT (user_id, friend_id) DO NOTHING
    `;

    // Told after the follow is durable, and never allowed to undo it:
    // notifyFollow swallows its own failures (see lib/notifications.ts). The
    // notice is deliberately NOT conditional on the insert having been new --
    // its own unique index already makes it once-per-person-forever, so a
    // re-follow is silent without this needing to know that.
    await notifyFollow(friendId, userId);
    return true;
}

/** Removes a friend. Returns false if they weren't one, so the route can be
 * honest about whether anything changed. */
export async function removeFriend(userId: number, friendId: number): Promise<boolean> {
    const rows = await sql<{ friend_id: number }[]>`
        DELETE FROM friends WHERE user_id = ${userId} AND friend_id = ${friendId}
        RETURNING friend_id
    `;
    return rows.length > 0;
}
