import { NextResponse } from "next/server";
import { searchSongs } from "@/lib/itunes";

/**
 * GET /api/songs/search?term=...
 *
 * No auth guard: search is one of the tools that works fully signed out.
 * Always returns 200 with a `results` array, even on an empty query or an
 * unreachable upstream -- see lib/itunes.ts's header for why a search
 * failure is never a 500 here.
 */
export async function GET(req: Request) {
    const term = new URL(req.url).searchParams.get("term") ?? "";

    try {
        // `unreachable` rides along so the caller can distinguish "Apple has
        // nothing like that" from "Apple never answered" -- see SearchOutcome
        // in lib/itunes.ts. Both arrive as an empty array, and only one of
        // them means the song does not exist.
        const { results, unreachable } = await searchSongs(term);
        return NextResponse.json({ results, unreachable });
    } catch (err) {
        // searchSongs already catches its own upstream failures; this is a
        // last-resort net for a bug in this route itself, not the normal path.
        console.error("SONG SEARCH ERROR:", err);
        return NextResponse.json({ results: [], unreachable: true });
    }
}
