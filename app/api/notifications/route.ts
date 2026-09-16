import { NextResponse } from "next/server";
import { requireUser, isGuardFailure } from "@/lib/auth-guard";
import { listNotifications, markAllRead, unreadCount } from "@/lib/notifications";

/**
 * GET  -> your notices, newest first, plus the unread count for the bell.
 * POST -> marks them all read.
 *
 * `?countOnly=1` skips the list, because the header badge asks this on every
 * page and only ever renders a number. Fetching fifty rows to display one
 * integer would be the sort of thing that is fine until it isn't.
 */
export async function GET(req: Request) {
    const g = await requireUser();
    if (isGuardFailure(g)) return g.response;

    const countOnly = new URL(req.url).searchParams.get("countOnly") === "1";

    try {
        if (countOnly) return NextResponse.json({ unread: await unreadCount(g.userId) });
        const [notifications, unread] = await Promise.all([
            listNotifications(g.userId),
            unreadCount(g.userId),
        ]);
        return NextResponse.json({ notifications, unread });
    } catch (err) {
        console.error("LIST NOTIFICATIONS ERROR:", err);
        return NextResponse.json({ error: "Could not load your notifications" }, { status: 500 });
    }
}

export async function POST() {
    const g = await requireUser();
    if (isGuardFailure(g)) return g.response;

    try {
        return NextResponse.json({ ok: true, marked: await markAllRead(g.userId) });
    } catch (err) {
        console.error("MARK NOTIFICATIONS READ ERROR:", err);
        return NextResponse.json({ error: "Could not mark those as read" }, { status: 500 });
    }
}
