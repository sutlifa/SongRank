import { NextResponse } from "next/server";
import { requireUser, isGuardFailure } from "@/lib/auth-guard";
import { checkUsername, normaliseUsername } from "@/lib/username";
import { setUsername } from "@/lib/users";

/**
 * Sets or changes the caller's handle.
 *
 * Validated with the same `checkUsername` the form uses, rather than trusting
 * that it ran: the client check is there to answer instantly, not to be the
 * rule. Uniqueness is decided by the database (see setUsername in
 * lib/users.ts) because it is the only place that can answer correctly when
 * two people submit the same handle at the same moment.
 */
export async function POST(req: Request) {
    const g = await requireUser();
    if (isGuardFailure(g)) return g.response;

    try {
        const body = (await req.json()) as { username?: unknown };
        if (typeof body.username !== "string") {
            return NextResponse.json({ error: "Pick a username." }, { status: 400 });
        }

        const username = normaliseUsername(body.username);
        const problem = checkUsername(username);
        if (problem) return NextResponse.json({ error: problem }, { status: 400 });

        const result = await setUsername(g.userId, username);
        if (result === "taken") {
            return NextResponse.json({ error: "That username is already taken." }, { status: 409 });
        }

        return NextResponse.json({ ok: true, username });
    } catch (err) {
        console.error("SET USERNAME ERROR:", err);
        return NextResponse.json({ error: "Could not save that username" }, { status: 500 });
    }
}
