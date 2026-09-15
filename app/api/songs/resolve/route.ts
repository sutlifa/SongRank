import { NextResponse } from "next/server";
import { resolveSong } from "@/lib/itunes";

/**
 * POST /api/songs/resolve  { title, artist }
 *
 * Called once per song after the paste-review table is confirmed, to fill in
 * artwork/preview for songs the user typed or pasted rather than picked from
 * search results. No auth guard -- this runs during ordinary, signed-out use
 * of /new. Always 200 with `preview: null` on no match or upstream failure,
 * never a 500: a real track legitimately having no preview is an expected
 * outcome, not an error (see lib/itunes.ts).
 */
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const title = typeof body?.title === "string" ? body.title : "";
        const artist = typeof body?.artist === "string" ? body.artist : "";
        if (!title.trim()) {
            return NextResponse.json({ error: "Missing title" }, { status: 400 });
        }

        const preview = await resolveSong(title, artist);
        return NextResponse.json({ preview });
    } catch (err) {
        console.error("SONG RESOLVE ERROR:", err);
        return NextResponse.json({ preview: null });
    }
}
