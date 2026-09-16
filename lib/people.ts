// lib/people.ts
//
// The people directory: finding someone so you can follow their public
// rankings.
//
// ## What this deliberately does not do
//
// The brief asked for a searchable directory showing each person's name and
// email. Names, yes. Publishing email addresses is a different thing: a
// directory that hands out every user's address to any visitor is a mailing
// list for anyone who scrapes it, and nobody signing in with Google to rank
// songs agreed to that. So:
//
//   - **Names** are searchable by substring, the normal way you look someone
//     up, and shown in full.
//   - **Emails** are searchable only by an EXACT, whole-address match. That
//     keeps the case the feature is actually for -- "my friend is
//     sam@example.com, find them" -- while making the directory useless for
//     harvesting: you cannot discover an address you do not already know, and
//     a prefix like "sam@" matches nothing.
//   - **Emails are never returned in full.** Every result carries a masked
//     form instead (`sa••••@gmail.com`), which is enough to confirm you found
//     the right Sam and not enough to write to them.
//
// Nothing else about a person is exposed here, and rankings they have not
// made public are not visible to anyone through any query in this file.

import { sql } from "./db";

/** Cap on rows returned by a search, so a one-letter query can't pull the
 * whole user table into a page. */
const SEARCH_LIMIT = 24;

export interface PersonSummary {
    id: number;
    name: string | null;
    image: string | null;
    /** Never the real address -- see `maskEmail`. */
    maskedEmail: string;
    /** How many of their rankings are public. Zero is worth showing: it is the
     * honest answer to "is there anything to look at here". */
    publicRankings: number;
}

/**
 * `sam@example.com` -> `sa••••@example.com`.
 *
 * The domain is kept whole because it is what makes an address recognisable
 * ("the gmail one, not the work one") and is not itself identifying. The local
 * part keeps at most its first two characters; anything shorter than that
 * keeps one, and an address with no `@` at all -- which should not exist, but
 * this must not throw on bad data -- is masked entirely.
 */
export function maskEmail(email: string): string {
    const at = email.lastIndexOf("@");
    if (at <= 0) return "•••";
    const local = email.slice(0, at);
    const domain = email.slice(at);
    const keep = local.length <= 2 ? 1 : 2;
    return `${local.slice(0, keep)}${"•".repeat(Math.max(2, local.length - keep))}${domain}`;
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
    email: string;
    image: string | null;
    public_rankings: string;
}

function toSummary(row: PersonRow): PersonSummary {
    return {
        id: row.id,
        name: row.name,
        image: row.image,
        maskedEmail: maskEmail(row.email),
        // COUNT comes back from postgres as a bigint, which postgres.js hands
        // over as a string rather than silently losing precision.
        publicRankings: Number(row.public_rankings),
    };
}

/**
 * Finds people by name fragment, or by exact email address.
 *
 * `viewerId` is excluded from results -- you are not someone you can follow,
 * and seeing yourself in a people search is noise every time.
 */
export async function searchPeople(query: string, viewerId: number | null): Promise<PersonSummary[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];

    const exclude = viewerId ?? -1;

    const rows = looksLikeEmail(trimmed)
        ? await sql<PersonRow[]>`
              SELECT u.id, u.name, u.email, u.image,
                     (SELECT COUNT(*) FROM tournaments t
                       WHERE t.user_id = u.id AND t.visibility = 'public') AS public_rankings
              FROM users u
              WHERE lower(u.email) = ${trimmed.toLowerCase()} AND u.id <> ${exclude}
              LIMIT ${SEARCH_LIMIT}
          `
        : await sql<PersonRow[]>`
              SELECT u.id, u.name, u.email, u.image,
                     (SELECT COUNT(*) FROM tournaments t
                       WHERE t.user_id = u.id AND t.visibility = 'public') AS public_rankings
              FROM users u
              WHERE u.name ILIKE ${"%" + trimmed + "%"} AND u.id <> ${exclude}
              ORDER BY public_rankings DESC, lower(u.name)
              LIMIT ${SEARCH_LIMIT}
          `;

    return rows.map(toSummary);
}

/** One person, for their profile page. Null when there is no such user. */
export async function getPerson(id: number): Promise<PersonSummary | null> {
    const rows = await sql<PersonRow[]>`
        SELECT u.id, u.name, u.email, u.image,
               (SELECT COUNT(*) FROM tournaments t
                 WHERE t.user_id = u.id AND t.visibility = 'public') AS public_rankings
        FROM users u
        WHERE u.id = ${id}
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
        SELECT u.id, u.name, u.email, u.image,
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
