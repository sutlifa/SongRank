import { NextResponse } from "next/server";
import { listTournaments } from "@/lib/queries";
import { requireUser, isGuardFailure } from "@/lib/auth-guard";
import { saveGuarded } from "@/lib/tournamentSave";

export async function GET() {
    const g = await requireUser();
    if (isGuardFailure(g)) return g.response;

    try {
        return NextResponse.json({ tournaments: await listTournaments(g.userId) });
    } catch (err) {
        console.error("LIST TOURNAMENTS ERROR:", err);
        return NextResponse.json({ error: "Could not load your history" }, { status: 500 });
    }
}

/**
 * POST /api/tournaments  { id, name, clipSeconds, songs, votes }
 *
 * Creates a new saved tournament, or overwrites one this user already owns
 * with a matching id -- the same upsert /api/tournaments/[id]'s PUT uses
 * (see lib/tournamentSave.ts's saveGuarded). Both routes exist because the
 * client needs two different entry points: this one right after /new ("save
 * this so I can resume it later"), and the [id] one on every subsequent vote
 * ("keep the save current").
 */
export async function POST(req: Request) {
    const g = await requireUser();
    if (isGuardFailure(g)) return g.response;

    try {
        const body = await req.json();
        return await saveGuarded(g.userId, body);
    } catch (err) {
        console.error("SAVE TOURNAMENT ERROR:", err);
        return NextResponse.json({ error: "Could not save your tournament" }, { status: 500 });
    }
}
