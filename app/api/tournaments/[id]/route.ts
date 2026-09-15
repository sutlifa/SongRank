import { NextResponse } from "next/server";
import { getTournament, deleteTournament } from "@/lib/queries";
import { requireUser, isGuardFailure } from "@/lib/auth-guard";
import { saveGuarded } from "@/lib/tournamentSave";

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
    const g = await requireUser();
    if (isGuardFailure(g)) return g.response;

    const { id } = await context.params;

    try {
        const row = await getTournament(g.userId, id);
        // Someone else's row is reported missing rather than forbidden, so the
        // response can't be used to confirm a tournament id exists at all.
        if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

        return NextResponse.json({
            tournament: {
                id: row.id,
                name: row.name,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
                clipSeconds: row.clip_seconds,
                songs: row.songs,
                votes: row.votes,
            },
        });
    } catch (err) {
        console.error("GET TOURNAMENT ERROR:", err);
        return NextResponse.json({ error: "Could not load that tournament" }, { status: 500 });
    }
}

/** Re-saves an already-created tournament -- see saveGuarded in ../route.ts. */
export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
    const g = await requireUser();
    if (isGuardFailure(g)) return g.response;

    const { id } = await context.params;

    try {
        const body = await req.json();
        // The path id wins over anything the body claims, so this endpoint can
        // never be used to write a different tournament than the one it names.
        return await saveGuarded(g.userId, { ...(body as object), id });
    } catch (err) {
        console.error("SAVE TOURNAMENT ERROR:", err);
        return NextResponse.json({ error: "Could not save your tournament" }, { status: 500 });
    }
}

export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
    const g = await requireUser();
    if (isGuardFailure(g)) return g.response;

    const { id } = await context.params;

    try {
        const removed = await deleteTournament(g.userId, id);
        if (!removed) return NextResponse.json({ error: "Not found" }, { status: 404 });
        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error("DELETE TOURNAMENT ERROR:", err);
        return NextResponse.json({ error: "Could not delete that tournament" }, { status: 500 });
    }
}
