import postgres from "postgres";

// Falls back to an empty string instead of throwing at module load so that
// `next build`'s route analysis (which imports this module without ever
// running a query) doesn't fail just because DATABASE_URL isn't set in the
// current environment. postgres.js doesn't open a connection until the
// first query runs, so a real, clear connection error only surfaces then.
//
// `prepare: false` is required against Neon's pooled connection string (and
// any PgBouncer-style transaction pooler): prepared statements are tied to a
// single backend connection, which a transaction pooler doesn't guarantee
// across queries, and a schema change (e.g. an ALTER TABLE) can leave a
// stale cached plan behind that throws "cached plan must not change result
// type" on the next query.
export const sql = postgres(process.env.DATABASE_URL ?? "", {
    ssl: "require",
    prepare: false,
});

/** True when a database is actually configured for this environment. */
export const hasDatabase = Boolean(process.env.DATABASE_URL);
