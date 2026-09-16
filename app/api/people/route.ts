import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { hasDatabase } from "@/lib/db";
import { searchPeople } from "@/lib/people";

/**
 * People search, for the directory's live search box.
 *
 * Deliberately NOT behind requireUser: browsing who is on the site works
 * signed out, the same as browsing public rankings does. It still returns only
 * what lib/people.ts allows -- names, avatars, masked emails, and a count of
 * public rankings -- and an email only ever matches on a whole address, so
 * this endpoint cannot be walked to harvest addresses.
 */
export async function GET(req: Request) {
    if (!hasDatabase) return NextResponse.json({ people: [] });

    const q = new URL(req.url).searchParams.get("q") ?? "";
    if (q.trim().length < 2) return NextResponse.json({ people: [] });

    try {
        const session = await auth();
        const viewerId = session?.user?.id ?? null;
        const people = await searchPeople(q, viewerId);
        return NextResponse.json({ people });
    } catch (err) {
        console.error("PEOPLE SEARCH ERROR:", err);
        return NextResponse.json({ error: "Could not search for people" }, { status: 500 });
    }
}
