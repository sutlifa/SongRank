import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { hasDatabase } from "./db";
import { MAX_NAME_LENGTH, checkName } from "./name";

/**
 * Shared guard for every endpoint under /api/tournaments.
 *
 * History (saving a tournament server-side, listing it back, resuming it on
 * another device) is the one part of SongRank that needs an account and a
 * database. Everything else -- import, play, results, every export -- works
 * with no session and no DATABASE_URL at all, so this guard is deliberately
 * narrow: it is only ever imported by the /api/tournaments routes, never by
 * /api/songs or /api/preview.
 */

/**
 * Re-exported from lib/name.ts, not defined here: `checkName` and
 * `MAX_NAME_LENGTH` need to be importable from a client component too (the
 * inline tournament-rename affordance validates the same way before it ever
 * hits the network), and this module pulls in `next/server` and `@/auth`,
 * which a client bundle can't have. See lib/name.ts's header.
 */
export { MAX_NAME_LENGTH, checkName };
/**
 * A tournament's songs + votes as JSON, capped well above anything MAX_SONGS
 * (256) plus a full vote log could produce, so a legitimate save always fits
 * and a malformed or abusive payload is rejected before it reaches postgres.
 */
export const MAX_TOURNAMENT_BYTES = 2_000_000;

export type Guarded = { userId: number } | { response: NextResponse };

export async function requireUser(): Promise<Guarded> {
    if (!hasDatabase) {
        return {
            response: NextResponse.json(
                { error: "Saved history isn't configured on this deployment." },
                { status: 503 }
            ),
        };
    }

    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
        return { response: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
    }

    return { userId };
}

export function isGuardFailure(g: Guarded): g is { response: NextResponse } {
    return "response" in g;
}
