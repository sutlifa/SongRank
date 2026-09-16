import { NextResponse } from "next/server";
import { requireUser, isGuardFailure } from "@/lib/auth-guard";
import { copyTournament, getPublicTournament } from "@/lib/queries";
import { MAX_NAME_LENGTH } from "@/lib/name";

/**
 * Copies a public ranking's song list into a new, private ranking of your own.
 *
 * Only the songs travel -- see copyTournament in lib/queries.ts for why the
 * votes deliberately do not, and why the source row cannot be touched by this
 * operation.
 */
export async function POST(_req: Request, context: { params: Promise<{ id: string }> }) {
    const g = await requireUser();
    if (isGuardFailure(g)) return g.response;

    const { id } = await context.params;

    try {
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

        const created = await copyTournament({ userId: g.userId, sourceId: id, newId, name });
        if (!created) {
            return NextResponse.json({ error: "Could not copy that list" }, { status: 404 });
        }

        return NextResponse.json({ ok: true, id: newId, name });
    } catch (err) {
        console.error("COPY TOURNAMENT ERROR:", err);
        return NextResponse.json({ error: "Could not copy that list" }, { status: 500 });
    }
}
