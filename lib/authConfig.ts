// lib/authConfig.ts

/**
 * Whether Google sign-in is actually usable in this environment.
 *
 * Read on the server at render time (never in the browser -- the secret must
 * not ship to a client bundle) and passed down as a plain boolean prop. When
 * it is false the app hides every sign-in affordance rather than offering a
 * button that leads to a 500: every tool here works signed out by design, so
 * an unconfigured deployment should simply look like a version of the site
 * that never grew accounts, not a broken one.
 *
 * This is a plain env read, not `cookies()`/`headers()`, so pages that use it
 * stay statically prerenderable.
 */
export function hasGoogleCredentials(): boolean {
    return Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
}

/**
 * Sign-in requires a database as well as Google credentials.
 *
 * This is not belt-and-braces: `auth.ts`'s `jwt` callback calls `upsertUser`
 * on every sign-in, which writes a row to Postgres. With Google configured
 * but `DATABASE_URL` empty, the sign-in button appears, Google authenticates
 * the user for real, and the callback then throws on a connection string that
 * points nowhere -- a broken sign-in, which is strictly worse than no sign-in
 * button at all. Half-configuring this way is the natural result of adding
 * Google credentials and Neon in separate sittings, so the gate has to cover
 * both halves rather than trusting the order they were set in.
 *
 * Read via `process.env` directly instead of importing `hasDatabase` from
 * ./db, to keep this module a plain env read with no `postgres` import behind
 * it -- that is what lets the pages calling it stay statically prerenderable.
 */
export function isAuthConfigured(): boolean {
    return hasGoogleCredentials() && Boolean(process.env.DATABASE_URL);
}
