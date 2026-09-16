import { NextResponse } from "next/server";
import { getTournament, purgeTournament, restoreTournament, softDeleteTournament } from "@/lib/queries";
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
                format: row.format,
                depth: row.depth ?? undefined,
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

/**
 * Deletes a ranking -- reversibly by default.
 *
 * The ordinary delete moves it to "recently deleted", where it stays until the
 * owner explicitly says otherwise. `?permanent=1` is the irreversible one, and
 * is only ever sent from the "Delete forever" button in that list.
 *
 * Splitting them on a query parameter rather than into two routes keeps the
 * default the safe one: a caller that forgets the flag gets the recoverable
 * behaviour, which is the right way round for the mistake to fall.
 */
export async function DELETE(req: Request, context: { params: Promise<{ id: string }> }) {
    const g = await requireUser();
    if (isGuardFailure(g)) return g.response;

    const { id } = await context.params;
    const permanent = new URL(req.url).searchParams.get("permanent") === "1";

    try {
        const removed = permanent
            ? await purgeTournament(g.userId, id)
            : await softDeleteTournament(g.userId, id);
        if (!removed) return NextResponse.json({ error: "Not found" }, { status: 404 });
        return NextResponse.json({ ok: true, permanent });
    } catch (err) {
        console.error("DELETE TOURNAMENT ERROR:", err);
        return NextResponse.json({ error: "Could not delete that ranking" }, { status: 500 });
    }
}

/** Brings a ranking back from "recently deleted". */
export async function PATCH(_req: Request, context: { params: Promise<{ id: string }> }) {
    const g = await requireUser();
    if (isGuardFailure(g)) return g.response;

    const { id } = await context.params;

    try {
        const restored = await restoreTournament(g.userId, id);
        if (!restored) return NextResponse.json({ error: "Not found" }, { status: 404 });
        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error("RESTORE TOURNAMENT ERROR:", err);
        return NextResponse.json({ error: "Could not restore that ranking" }, { status: 500 });
    }
}
