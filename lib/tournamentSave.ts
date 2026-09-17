import { NextResponse } from "next/server";
import { getTournamentOwner, saveTournament } from "./queries";
import { notifyCopy } from "./notifications";
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
        sourceTournamentId?: unknown;
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

    // Only a plausibly-shaped id is passed through; whether it names a real,
    // public, undeleted ranking is decided by the subselect in saveTournament,
    // which is the only place that can answer it truthfully. A bad value there
    // becomes null rather than an error, so a stale or mistyped source link
    // costs the attribution and nothing else.
    const sourceTournamentId =
        typeof b.sourceTournamentId === "string" && b.sourceTournamentId.length > 0 && b.sourceTournamentId.length <= 64
            ? b.sourceTournamentId
            : null;

    const saved = await saveTournament({
        userId,
        id: b.id,
        name: String(b.name).trim(),
        clipSeconds,
        format,
        depth,
        songs: b.songs as never,
        votes: b.votes as never,
        sourceTournamentId,
    });

    // A save that would have discarded votes is reported as a conflict, not a
    // success. 409 rather than 400: the request is well-formed and the client
    // is not at fault -- it is simply behind, which is a state, not a mistake.
    // The stored count rides along so the client can say how far behind, and
    // so a human reading a network log can see what was protected.
    if (saved.refused) {
        return NextResponse.json(
            {
                error: "This device is behind — it has fewer picks than the saved copy, so nothing was overwritten.",
                storedVotes: saved.refused.storedVotes,
                incomingVotes: saved.refused.incomingVotes,
            },
            { status: 409 }
        );
    }

    // "Someone used your list", told once, when the copy is first created.
    //
    // Gated on `inserted` because this same function backs every autosave: the
    // statement re-runs on every vote, and without that check the owner would
    // be notified once per matchup. Gated on the STORED source rather than the
    // requested one, so a source that failed the public/undeleted check can't
    // address a notice to anyone.
    if (saved.inserted && saved.sourceTournamentId) {
        const owner = await getTournamentOwner(saved.sourceTournamentId);
        // notifyCopy refuses a self-notice itself, so copying your own list is
        // silent without this needing to check.
        if (owner) await notifyCopy(owner.ownerId, userId, saved.sourceTournamentId);
    }

    return NextResponse.json({ ok: true, id: b.id });
}
