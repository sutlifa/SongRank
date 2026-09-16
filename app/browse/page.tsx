import Link from "next/link";
import { auth } from "@/auth";
import { hasDatabase } from "@/lib/db";
import { isAuthConfigured } from "@/lib/authConfig";
import { listPublicTournaments } from "@/lib/queries";
import { friendIds } from "@/lib/friends";
import PublicRankingCard from "@/components/PublicRankingCard";
import SharingUnavailable from "@/components/SharingUnavailable";

export const metadata = {
    title: "Browse",
    description: "Public song rankings from everyone on SongRank.",
};

/** Always fresh: this is a feed of what people are doing right now, and a
 * cached copy of it is wrong the moment anyone publishes. */
export const dynamic = "force-dynamic";

export default async function BrowsePage() {
    if (!hasDatabase || !isAuthConfigured()) return <SharingUnavailable what="Browsing" />;

    const session = await auth();
    const viewerId = session?.user?.id ?? null;

    // One query for everyone's public rankings, then split locally against the
    // viewer's friend ids -- see listPublicTournaments for why the split isn't
    // done in SQL.
    const [all, friends] = await Promise.all([
        listPublicTournaments(),
        viewerId ? friendIds(viewerId) : Promise.resolve(new Set<number>()),
    ]);

    const fromFriends = all.filter((r) => friends.has(r.owner_id));
    const fromEveryoneElse = all.filter((r) => !friends.has(r.owner_id));

    return (
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
            <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold sm:text-3xl">Browse</h1>
                    <p className="mt-1 max-w-2xl text-sm leading-relaxed text-fg-muted">
                        Rankings people have chosen to make public. Open one to see how it came out,
                        rank the same songs yourself, and compare.
                    </p>
                </div>
                <Link href="/people" className="btn-secondary shrink-0">
                    Find people
                </Link>
            </div>

            {all.length === 0 && (
                <p className="card p-6 text-sm text-fg-muted">
                    Nobody has made a ranking public yet. Yours could be the first — finish one, then
                    use the &ldquo;Who can see this&rdquo; switch on its results page.
                </p>
            )}

            {viewerId && (
                <section className="mb-12">
                    <h2 className="text-lg font-semibold">From people you follow</h2>
                    <p className="mb-4 text-sm text-fg-muted">
                        {friends.size === 0
                            ? "You're not following anyone yet."
                            : fromFriends.length === 0
                              ? "Nobody you follow has published a ranking yet."
                              : "Newest first."}
                    </p>
                    {fromFriends.length > 0 ? (
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            {fromFriends.map((r) => (
                                <PublicRankingCard key={r.id} ranking={r} />
                            ))}
                        </div>
                    ) : (
                        <Link href="/people" className="btn-secondary">
                            Find people to follow
                        </Link>
                    )}
                </section>
            )}

            {fromEveryoneElse.length > 0 && (
                <section>
                    <h2 className="text-lg font-semibold">
                        {viewerId ? "Everyone else" : "Public rankings"}
                    </h2>
                    <p className="mb-4 text-sm text-fg-muted">Newest first.</p>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {fromEveryoneElse.map((r) => (
                            <PublicRankingCard key={r.id} ranking={r} />
                        ))}
                    </div>
                </section>
            )}

            {!viewerId && all.length > 0 && (
                <p className="mt-10 text-center text-sm text-fg-muted">
                    <Link href="/signin?callbackUrl=/browse" className="text-accent underline underline-offset-2">
                        Sign in
                    </Link>{" "}
                    to follow people, so their rankings come first here.
                </p>
            )}
        </div>
    );
}
