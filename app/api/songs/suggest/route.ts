import { NextResponse } from "next/server";
import { suggestMatches } from "@/lib/itunes";

/**
 * POST /api/songs/suggest  { title, artist }
 *
 * Problem B: the pre-flight screen's automatic "here are some candidates"
 * lookup for any song with no preview or only a weak match -- see
 * PreflightCheck.tsx. Distinct from /api/songs/search (a plain free-text
 * box the user drives) and from /api/songs/resolve (one best-guess pick):
 * this one runs the title/primary-artist query cascade in lib/itunes.ts and
 * pools several of its candidates so the screen can offer a short list to
 * choose from instead of a single silent guess.
 *
 * No auth guard, same as the other two /api/songs routes -- pre-flight is
 * part of ordinary, signed-out use of /new. Always 200 with an empty
 * `suggestions` array on no match or upstream failure, never a 500: see
 * lib/itunes.ts's header for why an empty result here is an expected
 * outcome, not an error.
 */
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const title = typeof body?.title === "string" ? body.title : "";
        const artist = typeof body?.artist === "string" ? body.artist : "";
        if (!title.trim()) {
            return NextResponse.json({ error: "Missing title" }, { status: 400 });
        }

        const suggestions = await suggestMatches(title, artist);
        return NextResponse.json({ suggestions });
    } catch (err) {
        console.error("SONG SUGGEST ERROR:", err);
        return NextResponse.json({ suggestions: [] });
    }
}
