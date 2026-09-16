import { NextResponse } from "next/server";
import { requireUser, isGuardFailure } from "@/lib/auth-guard";
import { setTournamentVisibility, type Visibility } from "@/lib/queries";

/**
 * Makes one of your own rankings public, or takes it private again.
 *
 * A route of its own rather than another field on PUT /api/tournaments/[id]:
 * that endpoint is the autosave, fired on every vote with the whole song list
 * and vote log in the body. Publishing is a deliberate, once-in-a-ranking
 * decision, and folding it into the call that fires two hundred times a
 * session would make "did I publish this?" depend on whatever the last
 * autosave happened to carry.
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
    const g = await requireUser();
    if (isGuardFailure(g)) return g.response;

    const { id } = await context.params;

    try {
        const body = (await req.json()) as { visibility?: unknown };
        const visibility = body.visibility;
        if (visibility !== "public" && visibility !== "private") {
            return NextResponse.json({ error: "Visibility must be public or private" }, { status: 400 });
        }

        // Scoped to the caller inside the UPDATE itself -- someone else's
        // ranking simply doesn't match, and is reported missing rather than
        // forbidden so the response can't confirm an id exists.
        const changed = await setTournamentVisibility(g.userId, id, visibility as Visibility);
        if (!changed) return NextResponse.json({ error: "Not found" }, { status: 404 });

        return NextResponse.json({ ok: true, visibility });
    } catch (err) {
        console.error("SET VISIBILITY ERROR:", err);
        return NextResponse.json({ error: "Could not change who can see this ranking" }, { status: 500 });
    }
}
