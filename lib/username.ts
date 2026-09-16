// lib/username.ts
//
// Usernames: the handle people are found by, so nobody has to hand out an
// email address to be findable.
//
// Pure -- validation and normalisation only, no I/O. Uniqueness is the
// database's job (a unique index on lower(username), see lib/db/schema.sql),
// because it is the only place that can answer honestly under two people
// submitting the same name at the same moment.

/** Shortest allowed. Two characters is not enough to be a handle, and it
 * would hand the entire short-name space to whoever signed up first. */
export const USERNAME_MIN = 3;
/** Longest allowed. Fits on a card and in a profile heading without
 * truncation, which is the only real constraint. */
export const USERNAME_MAX = 20;

/**
 * Names nobody may take.
 *
 * A profile lives at /u/<handle>, so in principle only a collision *inside*
 * that segment could break routing. The list is wider than that on purpose:
 * these are words that read as the site speaking rather than as a person
 * ("@support" asking you for something is a phishing kit, not a username), or
 * that a future route would want. Reserving them costs nothing now and cannot
 * be done later without taking a name off someone.
 */
const RESERVED = new Set([
    "about", "account", "admin", "api", "auth", "browse", "compare", "contact",
    "help", "history", "home", "list", "lists", "me", "new", "people", "privacy",
    "profile", "r", "rank", "ranking", "rankings", "root", "settings", "signin",
    "signout", "songrank", "starters", "support", "t", "terms", "u", "user",
    "users", "null", "undefined", "anonymous", "everyone", "staff", "team",
]);

/**
 * The stored and compared form: trimmed and lowercased.
 *
 * Usernames are case-insensitive for uniqueness and lookup -- "@Sam" and
 * "@sam" must never be two people, because the difference is invisible when
 * spoken and nearly invisible when read. Lowercasing on the way in means the
 * database never holds two spellings of the same handle, and every lookup can
 * be a plain comparison rather than a remembered `lower()` at each call site.
 */
export function normaliseUsername(raw: string): string {
    return raw.trim().toLowerCase();
}

/**
 * Why a username can't be used, or null if it can.
 *
 * Returns the message a person reads, not a code: every one of these is
 * something they can act on, and there is no second layer that would translate
 * a code into better wording than this.
 */
export function checkUsername(raw: string): string | null {
    const name = normaliseUsername(raw);

    if (name.length === 0) return "Pick a username.";
    if (name.length < USERNAME_MIN) return `Usernames are at least ${USERNAME_MIN} characters.`;
    if (name.length > USERNAME_MAX) return `Usernames are at most ${USERNAME_MAX} characters.`;

    if (!/^[a-z0-9_]+$/.test(name)) {
        return "Usernames can use letters, numbers and underscores only.";
    }
    // An all-digit handle would be ambiguous with a numeric user id, which
    // /u/<handle> still accepts so that links shared before usernames existed
    // keep working. Banning the overlap is what lets that route stay
    // unambiguous forever rather than until someone registers "12".
    if (/^[0-9]+$/.test(name)) return "Usernames need at least one letter.";
    if (name.startsWith("_") || name.endsWith("_")) {
        return "Usernames can't start or end with an underscore.";
    }
    if (name.includes("__")) return "Usernames can't contain two underscores in a row.";
    if (RESERVED.has(name)) return "That username is reserved.";

    return null;
}

/**
 * A starting suggestion built from a Google display name or email local part.
 *
 * Only ever a suggestion shown in the box for someone to accept or replace --
 * never assigned silently. A handle is how you are addressed; having one
 * chosen for you by a string transform is a small indignity, and the result
 * ("john_smith_1") is usually worse than what a person would pick in five
 * seconds. Returns null when nothing usable can be made, and the field simply
 * starts empty.
 */
export function suggestUsername(source: string | null | undefined): string | null {
    if (!source) return null;
    const base = normaliseUsername(source)
        .replace(/@.*$/, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "")
        .slice(0, USERNAME_MAX);
    return checkUsername(base) === null ? base : null;
}

/**
 * What a profile link should point at: the handle when there is one, the
 * numeric id otherwise. /u/<handle> accepts both, so a link shared before
 * someone picked a username keeps working afterwards.
 *
 * It lives in this module rather than next to `PersonSummary` in lib/people.ts
 * because client components need it, and lib/people.ts imports lib/db.ts --
 * so a *value* import from there drags the `postgres` driver into the browser
 * bundle and fails the build. Type-only imports are erased and stay fine; this
 * is the one thing that has to be reachable from both sides, so it belongs in
 * the module with no I/O in it.
 */
export function profilePath(person: { id: number; username: string | null }): string {
    return `/u/${person.username ?? person.id}`;
}
