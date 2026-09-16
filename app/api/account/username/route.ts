import { NextResponse } from "next/server";
import { requireUser, isGuardFailure } from "@/lib/auth-guard";
import { checkUsername, normaliseUsername } from "@/lib/username";
import { getUsername, setUsername } from "@/lib/users";

/**
 * The caller's own handle, or null if they have never set one.
 *
 * Exists so UsernameBanner can ask the one question it needs ("do I have one?")
 * from any page without the root layout having to call `auth()` -- which would
 * make every route in the app dynamic to answer a question that matters once
 * per account.
 *
 * Returns only the caller's own handle. There is no id parameter, so this can't
 * be used to look anyone else up; /api/people is the route for that, and it
 * returns no email address either.
 */
export async function GET() {
    const g = await requireUser();
    if (isGuardFailure(g)) return g.response;

    try {
        return NextResponse.json({ username: await getUsername(g.userId) });
    } catch (err) {
        console.error("GET USERNAME ERROR:", err);
        return NextResponse.json({ error: "Could not load your username" }, { status: 500 });
    }
}

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
