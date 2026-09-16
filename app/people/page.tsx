import Link from "next/link";
import { auth } from "@/auth";
import { hasDatabase } from "@/lib/db";
import { isAuthConfigured } from "@/lib/authConfig";
import { listActivePeople } from "@/lib/people";
import { listFriends } from "@/lib/friends";
import PeopleSearch from "@/components/PeopleSearch";
import PersonRow from "@/components/PersonRow";
import SharingUnavailable from "@/components/SharingUnavailable";

export const metadata = {
    title: "People",
    description: "Find people on SongRank and follow their public rankings.",
};

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
    if (!hasDatabase || !isAuthConfigured()) return <SharingUnavailable what="The people directory" />;

    const session = await auth();
    const viewerId = session?.user?.id ?? null;

    const [friends, active] = await Promise.all([
        viewerId ? listFriends(viewerId) : Promise.resolve([]),
        listActivePeople(viewerId),
    ]);
    const friendSet = new Set(friends.map((f) => f.id));

    return (
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
            <h1 className="mb-2 text-2xl font-bold sm:text-3xl">People</h1>
            <p className="mb-8 max-w-2xl text-sm leading-relaxed text-fg-muted">
                Find someone by name, or by their full email address if you already know it. You&apos;ll
                see their public rankings and nothing else — email addresses are never shown in full,
                and nothing private ever appears here.
            </p>

            <div className="card mb-10 p-4 sm:p-5">
                <PeopleSearch friendIds={[...friendSet]} />
            </div>

            {viewerId && (
                <section className="mb-10">
                    <h2 className="mb-3 text-lg font-semibold">Following ({friends.length})</h2>
                    {friends.length === 0 ? (
                        <p className="text-sm text-fg-muted">
                            Nobody yet. Search above, or pick someone out of the list below.
                        </p>
                    ) : (
                        <ul className="space-y-2">
                            {friends.map((person) => (
                                <li key={person.id}>
                                    <PersonRow person={person} />
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            )}

            <section>
                <h2 className="mb-1 text-lg font-semibold">Recently active</h2>
                <p className="mb-3 text-sm text-fg-muted">
                    People who have published at least one ranking, most recent first.
                </p>
                {active.length === 0 ? (
                    <p className="text-sm text-fg-muted">
                        Nobody has published a ranking yet.{" "}
                        <Link href="/new" className="text-accent underline underline-offset-2">
                            Be the first
                        </Link>
                        .
                    </p>
                ) : (
                    <ul className="space-y-2">
                        {active.map((person) => (
                            <li key={person.id}>
                                <PersonRow
                                    person={person}
                                    badge={friendSet.has(person.id) ? "Following" : undefined}
                                />
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}
