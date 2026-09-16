import { NextResponse } from "next/server";
import { requireUser, isGuardFailure } from "@/lib/auth-guard";
import { addFriend, removeFriend } from "@/lib/friends";

/** Parses a friend id from a request body, rejecting anything that isn't a
 * positive integer -- the ids are SERIAL, so that is the whole valid domain. */
function parseFriendId(body: unknown): number | null {
    const raw = (body as { friendId?: unknown } | null)?.friendId;
    const id = typeof raw === "number" ? raw : Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
}

export async function POST(req: Request) {
    const g = await requireUser();
    if (isGuardFailure(g)) return g.response;

    try {
        const friendId = parseFriendId(await req.json());
        if (friendId === null) return NextResponse.json({ error: "Bad request" }, { status: 400 });

        const added = await addFriend(g.userId, friendId);
        if (!added) {
            return NextResponse.json(
                { error: friendId === g.userId ? "You can't add yourself" : "No such person" },
                { status: 400 }
            );
        }
        return NextResponse.json({ ok: true, friend: true });
    } catch (err) {
        console.error("ADD FRIEND ERROR:", err);
        return NextResponse.json({ error: "Could not add that friend" }, { status: 500 });
    }
}

export async function DELETE(req: Request) {
    const g = await requireUser();
    if (isGuardFailure(g)) return g.response;

    try {
        const friendId = parseFriendId(await req.json());
        if (friendId === null) return NextResponse.json({ error: "Bad request" }, { status: 400 });

        // Removing someone who wasn't a friend still leaves you in the state
        // you asked for, so this reports ok rather than 404 -- the button that
        // calls it only ever wants "now not friends".
        await removeFriend(g.userId, friendId);
        return NextResponse.json({ ok: true, friend: false });
    } catch (err) {
        console.error("REMOVE FRIEND ERROR:", err);
        return NextResponse.json({ error: "Could not remove that friend" }, { status: 500 });
    }
}
