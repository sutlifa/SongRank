import { NextResponse } from "next/server";
import { saveTournament } from "./queries";
import { checkName, MAX_TOURNAMENT_BYTES } from "./auth-guard";
import { CLIP_SECONDS, RANKING_DEPTHS, type ClipSeconds, type RankingDepth, type TournamentFormat } from "./types";

/**
 * Validates and upserts a save-tournament request body. Shared by
 * POST /api/tournaments (first save, right after /new) and
 * PUT /api/tournaments/[id] (every autosave afterward) -- both are the same
 * upsert underneath (see lib/queries.ts's saveTournament), so the validation
 * only needs writing once. Deliberately its own module rather than one route
 * file importing from the other: route.ts files get framework-special
 * handling of their exports, and a plain shared helper avoids ever having to
 * wonder whether that handling affects a non-HTTP-verb export.
 */
export async function saveGuarded(userId: number, body: unknown): Promise<NextResponse> {
    const b = body as {
        id?: unknown;
        name?: unknown;
        clipSeconds?: unknown;
        format?: unknown;
        depth?: unknown;
        songs?: unknown;
        votes?: unknown;
    };

    if (typeof b.id !== "string" || !b.id.trim()) {
        return NextResponse.json({ error: "Missing tournament id" }, { status: 400 });
    }
    const nameError = checkName(b.name);
    if (nameError) return NextResponse.json({ error: nameError }, { status: 400 });
    if (!Array.isArray(b.songs) || b.songs.length === 0) {
        return NextResponse.json({ error: "Nothing to save" }, { status: 400 });
    }
    if (!Array.isArray(b.votes)) {
        return NextResponse.json({ error: "Malformed vote log" }, { status: 400 });
    }
    const clipSeconds: ClipSeconds = (CLIP_SECONDS as readonly number[]).includes(b.clipSeconds as number)
        ? (b.clipSeconds as ClipSeconds)
        : 15;
    // Anything that isn't literally "adaptive" defaults to "swiss" -- the
    // same rule Tournament.format's absence carries everywhere else (see
    // lib/types.ts). A client this old to omit the field entirely was built
    // before the adaptive engine existed, so its tournaments really are Swiss.
    const format: TournamentFormat = b.format === "adaptive" ? "adaptive" : "swiss";
    const depth: RankingDepth | null =
        format === "adaptive" && RANKING_DEPTHS.includes(b.depth as RankingDepth) ? (b.depth as RankingDepth) : null;

    const payloadSize = JSON.stringify({ songs: b.songs, votes: b.votes }).length;
    if (payloadSize > MAX_TOURNAMENT_BYTES) {
        return NextResponse.json({ error: "That tournament is too large to save" }, { status: 413 });
    }

    await saveTournament({
        userId,
        id: b.id,
        name: String(b.name).trim(),
        clipSeconds,
        format,
        depth,
        songs: b.songs as never,
        votes: b.votes as never,
    });

    return NextResponse.json({ ok: true, id: b.id });
}
