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
 *
 * `confidence` rides alongside `preview` (rather than being folded away)
 * because "found a preview" and "found a *confident* preview" aren't the
 * same thing -- a "partial" match still fills the row in, but the pre-flight
 * screen (see PreflightCheck.tsx) also treats it as needing suggestions, the
 * same as a flat miss. Always "none" when `preview` is null; resolveSong
 * never returns a candidate it scored "none" on.
 */
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const title = typeof body?.title === "string" ? body.title : "";
        const artist = typeof body?.artist === "string" ? body.artist : "";
        if (!title.trim()) {
            return NextResponse.json({ error: "Missing title" }, { status: 400 });
        }

        const resolved = await resolveSong(title, artist);
        // `unreachable` rides along so the client can tell a track Apple does
        // not have from one we never managed to ask about -- see
        // ResolveOutcome in lib/itunes.ts. Reporting the second as the first
        // is how a rate limit came to be displayed as a permanent-sounding
        // "No preview available for this track."
        return NextResponse.json({
            preview: resolved.match,
            confidence: resolved.confidence,
            unreachable: resolved.unreachable,
        });
    } catch (err) {
        console.error("SONG RESOLVE ERROR:", err);
        return NextResponse.json({ preview: null, confidence: "none", unreachable: true });
    }
}
