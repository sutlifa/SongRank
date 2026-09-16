import { sql, hasDatabase } from "./db";

export async function upsertUser(user: {
    googleId: string;
    email: string;
    name: string | null;
    image: string | null;
}): Promise<number> {
    // Defence in depth behind `isAuthConfigured`, which already refuses to
    // show sign-in without a database. If that gate is ever loosened, this
    // turns an opaque postgres connection error deep in an Auth.js callback
    // into a server log line that names the actual cause.
    if (!hasDatabase) {
        throw new Error(
            "upsertUser called with no DATABASE_URL set -- sign-in should be disabled in this environment (see lib/authConfig.ts)."
        );
    }

    const rows = await sql<{ id: number }[]>`
        INSERT INTO users (google_id, email, name, image)
        VALUES (${user.googleId}, ${user.email}, ${user.name}, ${user.image})
        ON CONFLICT (google_id) DO UPDATE SET
          email = EXCLUDED.email,
          name = EXCLUDED.name,
          image = EXCLUDED.image
        RETURNING id
    `;
    return rows[0].id;
}

/**
 * Deletes a user and everything belonging to them.
 *
 * Their saved rankings go with them automatically: `tournaments.user_id` is
 * declared `REFERENCES users(id) ON DELETE CASCADE` (see lib/db/schema.sql),
 * so Postgres removes those rows in the same statement. Deleting the rankings
 * separately first would be a second way to get this wrong -- a partial
 * failure between the two would leave an account with no data or data with no
 * account -- so the cascade is doing real work here, not just tidiness.
 *
 * Returns false if there was no such user, which makes the route's response
 * honest about whether anything was actually removed.
 */
export async function deleteUser(userId: number): Promise<boolean> {
    const rows = await sql<{ id: number }[]>`
        DELETE FROM users WHERE id = ${userId} RETURNING id
    `;
    return rows.length > 0;
}
