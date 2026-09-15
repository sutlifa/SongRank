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
