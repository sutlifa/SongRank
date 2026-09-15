import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { hasDatabase } from "./db";

/**
 * Shared guard for every endpoint under /api/tournaments.
 *
 * History (saving a tournament server-side, listing it back, resuming it on
 * another device) is the one part of SongRank that needs an account and a
 * database. Everything else -- import, play, results, every export except
 * the Spotify one -- works with no session and no DATABASE_URL at all, so
 * this guard is deliberately narrow: it is only ever imported by the
 * /api/tournaments routes, never by /api/songs or /api/preview.
 */

export const MAX_NAME_LENGTH = 120;
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

/** Validates a user-supplied tournament name, returning an error message or null. */
export function checkName(name: unknown): string | null {
    const trimmed = typeof name === "string" ? name.trim() : "";
    if (!trimmed) return "Give it a name";
    if (trimmed.length > MAX_NAME_LENGTH) {
        return `Name is too long (max ${MAX_NAME_LENGTH} characters)`;
    }
    return null;
}
