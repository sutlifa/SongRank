// lib/notifications.ts
//
// In-app notices for the two things other people do that involve you:
// following you, and using one of your public lists to build their own
// ranking.
//
// ## Nothing here is allowed to break the thing that caused it
//
// Every write goes through `notify`, which never throws. A notification is a
// courtesy; a follow that fails because the notice failed, or a saved ranking
// that 500s because we could not write a row telling someone about it, would
// be trading something that matters for something that does not. The event is
// the product, the notice is decoration.
//
// ## One notice per person per thing, forever
//
// Enforced by a unique index rather than by checking first (see
// notifications_unique_event_idx in lib/db/schema.sql), because checking first
// is a race two concurrent follows could both win. Without the rule, following
// and unfollowing in a loop is an unbounded notification stream.

import { sql } from "./db";

export type NotificationKind = "follow" | "copy";

export interface NotificationRow {
    id: string;
    kind: NotificationKind;
    created_at: string;
    read_at: string | null;
    actor_id: number;
    actor_name: string | null;
    actor_username: string | null;
    /** The ranking of yours that was copied; null for a follow. */
    tournament_id: string | null;
    tournament_name: string | null;
}

/**
 * Records one notice, swallowing every failure.
 *
 * Returns whether a row was actually written, which is only used by the tests
 * -- no caller changes behaviour based on it, by design.
 */
async function notify(args: {
    userId: number;
    actorId: number;
    kind: NotificationKind;
    tournamentId?: string | null;
}): Promise<boolean> {
    // Never notify someone about their own action. The table has a CHECK for
    // this too; catching it here means the common case doesn't rely on an
    // exception path.
    if (args.userId === args.actorId) return false;

    try {
        const rows = await sql<{ id: string }[]>`
            INSERT INTO notifications (user_id, actor_id, kind, tournament_id)
            VALUES (${args.userId}, ${args.actorId}, ${args.kind}, ${args.tournamentId ?? null})
            ON CONFLICT DO NOTHING
            RETURNING id
        `;
        return rows.length > 0;
    } catch (err) {
        // A notice is never worth failing the action it describes. Logged so
        // a systematic failure is visible in the server log rather than silent.
        console.error("NOTIFY ERROR:", err);
        return false;
    }
}

/** "X followed you." */
export function notifyFollow(followedId: number, followerId: number): Promise<boolean> {
    return notify({ userId: followedId, actorId: followerId, kind: "follow" });
}

/** "X used your list <name>." `tournamentId` is the ranking of THEIRS that was
 * copied, so the notice can name it and link to it. */
export function notifyCopy(ownerId: number, copierId: number, tournamentId: string): Promise<boolean> {
    return notify({ userId: ownerId, actorId: copierId, kind: "copy", tournamentId });
}

/** Someone's notices, newest first. */
export async function listNotifications(userId: number, limit = 50): Promise<NotificationRow[]> {
    return sql<NotificationRow[]>`
        SELECT n.id, n.kind, n.created_at, n.read_at,
               n.actor_id, a.name AS actor_name, a.username AS actor_username,
               n.tournament_id, t.name AS tournament_name
        FROM notifications n
        JOIN users a ON a.id = n.actor_id
        LEFT JOIN tournaments t ON t.id = n.tournament_id
        WHERE n.user_id = ${userId}
        ORDER BY n.created_at DESC
        LIMIT ${limit}
    `;
}

/** How many are unread -- the number on the bell. */
export async function unreadCount(userId: number): Promise<number> {
    const rows = await sql<{ count: string }[]>`
        SELECT COUNT(*) AS count FROM notifications
        WHERE user_id = ${userId} AND read_at IS NULL
    `;
    // COUNT is a bigint, which postgres.js hands over as a string rather than
    // silently losing precision.
    return Number(rows[0]?.count ?? 0);
}

/** Marks everything read. Scoped to the caller, like every other write here. */
export async function markAllRead(userId: number): Promise<number> {
    const rows = await sql<{ id: string }[]>`
        UPDATE notifications SET read_at = now()
        WHERE user_id = ${userId} AND read_at IS NULL
        RETURNING id
    `;
    return rows.length;
}
