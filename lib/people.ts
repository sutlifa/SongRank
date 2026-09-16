// lib/people.ts
//
// The people directory: finding someone so you can follow their public
// rankings.
//
// ## Email addresses never leave the server
//
// People are found by **username** (see lib/username.ts) or by display name.
// That is the whole point of having handles: an email address is a way to
// contact someone, not a way to refer to them, and a directory that hands out
// every user's address to any visitor is a mailing list for whoever scrapes
// it. Nobody signing in with Google to rank songs agreed to that.
//
//   - **Usernames** are searchable by substring and shown in full. They are
//     chosen for this purpose, so there is nothing to protect.
//   - **Display names** are searchable by substring too, because that is what
//     you know about someone before you know their handle.
//   - **Emails** are searchable only by an EXACT, whole-address match, and
//     never returned in any form. That keeps the one case it is needed for --
//     finding a friend who has not picked a handle yet -- while making the
//     directory useless for harvesting: a prefix like "sam@" matches nothing,
//     and a match tells you only that an address you already had belongs to a
//     name you can already see.
//
// No query in this file returns an email address, masked or otherwise, and
// rankings someone has not made public are invisible through all of them.

import { sql } from "./db";

/** Cap on rows returned by a search, so a one-letter query can't pull the
 * whole user table into a page. */
const SEARCH_LIMIT = 24;

export interface PersonSummary {
    id: number;
    name: string | null;
    /** Their handle, or null if they have never set one. Note there is no
     * email field here at all -- not even a masked one. */
    username: string | null;
    image: string | null;
    /** How many of their rankings are public. Zero is worth showing: it is the
     * honest answer to "is there anything to look at here". */
    publicRankings: number;
}

/** True when the query is a whole email address rather than a name fragment.
 * Deliberately strict: anything short of a complete address is treated as a
 * name search, which is what stops partial-address probing. */
function looksLikeEmail(query: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(query);
}

interface PersonRow {
    id: number;
    name: string | null;
    username: string | null;
    image: string | null;
    public_rankings: string;
}

function toSummary(row: PersonRow): PersonSummary {
    return {
        id: row.id,
        name: row.name,
        username: row.username,
        image: row.image,
        // COUNT comes back from postgres as a bigint, which postgres.js hands
        // over as a string rather than silently losing precision.
        publicRankings: Number(row.public_rankings),
    };
}

/**
 * Finds people by username or display-name fragment, or by exact email address.
 *
 * Username matches are ranked above name matches, because someone typing
 * "sam" who gets an exact handle back has found who they were looking for,
 * whereas a name substring is a guess.
 *
 * `viewerId` is excluded from results -- you are not someone you can follow,
 * and seeing yourself in a people search is noise every time.
 */
export async function searchPeople(query: string, viewerId: number | null): Promise<PersonSummary[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];

    const exclude = viewerId ?? -1;

    const like = `%${trimmed}%`;
    const rows = looksLikeEmail(trimmed)
        ? await sql<PersonRow[]>`
              SELECT u.id, u.name, u.username, u.image,
                     (SELECT COUNT(*) FROM tournaments t
                       WHERE t.user_id = u.id AND t.visibility = 'public') AS public_rankings
              FROM users u
              WHERE lower(u.email) = ${trimmed.toLowerCase()} AND u.id <> ${exclude}
              LIMIT ${SEARCH_LIMIT}
          `
        : await sql<PersonRow[]>`
              SELECT u.id, u.name, u.username, u.image,
                     (SELECT COUNT(*) FROM tournaments t
                       WHERE t.user_id = u.id AND t.visibility = 'public') AS public_rankings
              FROM users u
              WHERE (u.username ILIKE ${like} OR u.name ILIKE ${like}) AND u.id <> ${exclude}
              ORDER BY
                -- An exact handle first, then any handle match, then a name
                -- match: typing someone's username should put them at the top
                -- rather than behind whoever happens to have more public
                -- rankings.
                (lower(u.username) = ${trimmed.toLowerCase()}) DESC,
                (u.username ILIKE ${like}) DESC,
                public_rankings DESC,
                lower(u.name)
              LIMIT ${SEARCH_LIMIT}
          `;

    return rows.map(toSummary);
}

/** One person, for their profile page. Null when there is no such user. */
export async function getPerson(id: number): Promise<PersonSummary | null> {
    const rows = await sql<PersonRow[]>`
        SELECT u.id, u.name, u.username, u.image,
               (SELECT COUNT(*) FROM tournaments t
                 WHERE t.user_id = u.id AND t.visibility = 'public') AS public_rankings
        FROM users u
        WHERE u.id = ${id}
    `;
    return rows[0] ? toSummary(rows[0]) : null;
}

/**
 * One person by the handle in a /u/<handle> URL.
 *
 * Accepts a username or a numeric id, because profile links shared before
 * usernames existed point at ids and must keep working. The two can never be
 * confused: lib/username.ts refuses an all-digit handle precisely so this
 * branch stays unambiguous.
 */
export async function getPersonByHandle(handle: string): Promise<PersonSummary | null> {
    const trimmed = handle.trim();
    if (!trimmed) return null;

    if (/^[0-9]+$/.test(trimmed)) {
        const id = Number(trimmed);
        return Number.isSafeInteger(id) && id > 0 ? getPerson(id) : null;
    }

    const rows = await sql<PersonRow[]>`
        SELECT u.id, u.name, u.username, u.image,
               (SELECT COUNT(*) FROM tournaments t
                 WHERE t.user_id = u.id AND t.visibility = 'public') AS public_rankings
        FROM users u
        WHERE lower(u.username) = ${trimmed.toLowerCase()}
    `;
    return rows[0] ? toSummary(rows[0]) : null;
}

/**
 * People with at least one public ranking, most recently active first.
 *
 * This is the directory's idle state -- what you see before typing anything.
 * Someone with nothing public is left out: their profile would be an empty
 * page, and listing every account that has ever signed in is exactly the
 * address-book-of-strangers this file is trying not to be.
 */
export async function listActivePeople(viewerId: number | null, limit = 24): Promise<PersonSummary[]> {
    const exclude = viewerId ?? -1;
    const rows = await sql<PersonRow[]>`
        SELECT u.id, u.name, u.username, u.image,
               COUNT(t.id) AS public_rankings
        FROM users u
        JOIN tournaments t ON t.user_id = u.id AND t.visibility = 'public'
        WHERE u.id <> ${exclude}
        GROUP BY u.id
        ORDER BY MAX(t.updated_at) DESC
        LIMIT ${limit}
    `;
    return rows.map(toSummary);
}
