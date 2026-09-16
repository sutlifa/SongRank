import { NextResponse } from "next/server";
import { requireUser, isGuardFailure } from "@/lib/auth-guard";
import { copyTournament, getPublicTournament } from "@/lib/queries";
import { MAX_NAME_LENGTH } from "@/lib/name";
import { DEFAULT_CLIP_SECONDS, DEFAULT_DEPTH } from "@/lib/types";
import { RANKING_DEPTHS, type RankingDepth } from "@/lib/types";

/**
 * Copies a public ranking's song list into a new, private ranking of your own.
 *
 * Only the songs travel -- see copyTournament in lib/queries.ts for the full
 * rule, including why the copier's own depth is used rather than the source's
 * and why the source row cannot be touched by this operation.
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
    const g = await requireUser();
    if (isGuardFailure(g)) return g.response;

    const { id } = await context.params;

    try {
        // An absent or unrecognised depth falls back to the app default, not
        // to the source's. "I couldn't read your choice" must never resolve to
        // "use whatever the other person picked" -- that is the exact
        // behaviour this endpoint exists to stop.
        const body = (await req.json().catch(() => null)) as { depth?: unknown } | null;
        const depth: RankingDepth = RANKING_DEPTHS.includes(body?.depth as RankingDepth)
            ? (body!.depth as RankingDepth)
            : DEFAULT_DEPTH;

        // Read first so the response can name the list and explain a miss. The
        // INSERT re-checks `visibility = 'public'` itself, so this is a nicer
        // error path, not the access check -- that lives in the SQL.
        const source = await getPublicTournament(id);
        if (!source) {
            return NextResponse.json(
                { error: "That ranking isn't public, or no longer exists" },
                { status: 404 }
            );
        }

        const newId = crypto.randomUUID();
        const owner = source.owner_name?.trim();
        const name = `${source.name}${owner ? ` (from ${owner})` : ""}`.slice(0, MAX_NAME_LENGTH);

        const created = await copyTournament({
            userId: g.userId,
            sourceId: id,
            newId,
            name,
            depth,
            clipSeconds: DEFAULT_CLIP_SECONDS,
        });
        if (!created) {
            return NextResponse.json({ error: "Could not copy that list" }, { status: 404 });
        }

        return NextResponse.json({ ok: true, id: newId, name });
    } catch (err) {
        console.error("COPY TOURNAMENT ERROR:", err);
        return NextResponse.json({ error: "Could not copy that list" }, { status: 500 });
    }
}
