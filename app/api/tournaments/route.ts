import { NextResponse } from "next/server";
import { listDeletedTournaments, listTournaments } from "@/lib/queries";
import { requireUser, isGuardFailure } from "@/lib/auth-guard";
import { saveGuarded } from "@/lib/tournamentSave";

/**
 * Your saved rankings. `?deleted=1` returns the recently-deleted ones instead.
 *
 * One route with a flag rather than two, because they are the same list read
 * from the same table with one predicate flipped -- and because the default,
 * with no flag, is the live list, which is what every existing caller expects.
 */
export async function GET(req: Request) {
    const g = await requireUser();
    if (isGuardFailure(g)) return g.response;

    const deleted = new URL(req.url).searchParams.get("deleted") === "1";

    try {
        const tournaments = deleted
            ? await listDeletedTournaments(g.userId)
            : await listTournaments(g.userId);
        return NextResponse.json({ tournaments });
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
