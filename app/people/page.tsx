import Link from "next/link";
import { auth } from "@/auth";
import { hasDatabase } from "@/lib/db";
import { isAuthConfigured } from "@/lib/authConfig";
import { listActivePeople } from "@/lib/people";
import { listFriends } from "@/lib/friends";
import { getUsername } from "@/lib/users";
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

    const [friends, active, myUsername] = await Promise.all([
        viewerId ? listFriends(viewerId) : Promise.resolve([]),
        listActivePeople(viewerId),
        viewerId ? getUsername(viewerId) : Promise.resolve(null),
    ]);
    const friendSet = new Set(friends.map((f) => f.id));

    return (
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
            <h1 className="mb-2 text-2xl font-bold sm:text-3xl">People</h1>
            <p className="mb-8 max-w-2xl text-sm leading-relaxed text-fg-muted">
                Find someone by username or name. You&apos;ll see their public rankings and nothing
                else — email addresses are never shown here at all, and nothing private ever appears.
            </p>

            {viewerId && !myUsername && (
                <div className="mb-8 rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm">
                    <p className="font-semibold text-accent">You don&apos;t have a username yet.</p>
                    <p className="mt-1 text-fg-muted">
                        Without one, friends can only find you by your display name.{" "}
                        <Link href="/my-rankings" className="text-accent underline underline-offset-2">
                            Pick a username
                        </Link>{" "}
                        — it takes a second, and it means never having to hand out your email address.
                    </p>
                </div>
            )}

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
