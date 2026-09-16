import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { hasDatabase } from "@/lib/db";
import { isAuthConfigured } from "@/lib/authConfig";
import { getPersonByHandle } from "@/lib/people";
import { isFriend } from "@/lib/friends";
import { listPublicTournamentsByUser } from "@/lib/queries";
import FriendButton from "@/components/FriendButton";
import PublicRankingCard from "@/components/PublicRankingCard";
import SharingUnavailable from "@/components/SharingUnavailable";

export const dynamic = "force-dynamic";

/**
 * Someone's profile.
 *
 * The route parameter is a *handle*: a username, or a numeric user id. Both
 * resolve, because profile links shared before usernames existed point at ids
 * and breaking them would be a self-inflicted wound. They can never be
 * confused -- lib/username.ts refuses an all-digit username precisely so this
 * stays unambiguous no matter who signs up later.
 */
export default async function ProfilePage({ params }: { params: Promise<{ handle: string }> }) {
    if (!hasDatabase || !isAuthConfigured()) return <SharingUnavailable what="Profiles" />;

    const { handle } = await params;
    const person = await getPersonByHandle(decodeURIComponent(handle));
    if (!person) notFound();

    const session = await auth();
    const viewerId = session?.user?.id ?? null;
    const isSelf = viewerId === person.id;

    const [rankings, following] = await Promise.all([
        listPublicTournamentsByUser(person.id),
        viewerId && !isSelf ? isFriend(viewerId, person.id) : Promise.resolve(false),
    ]);

    const name = person.name?.trim() || person.username || "Someone";

    return (
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
            <header className="mb-8 flex flex-wrap items-start gap-4">
                <span
                    aria-hidden="true"
                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-bg-soft-2 text-xl font-bold text-fg-muted"
                >
                    {name.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                    <h1 className="text-2xl font-bold">{name}</h1>
                    {person.username && (
                        <p className="font-mono text-sm text-fg-muted">@{person.username}</p>
                    )}
                    <p className="mt-1 text-sm text-fg-muted">
                        {person.publicRankings} public {person.publicRankings === 1 ? "ranking" : "rankings"}
                    </p>
                </div>
            </header>

            {viewerId && !isSelf && (
                <div className="mb-8">
                    <FriendButton personId={person.id} personName={name} initiallyFriend={following} />
                </div>
            )}
            {isSelf && (
                <p className="mb-8 rounded-lg border border-border bg-bg-soft-2 px-4 py-3 text-sm text-fg-muted">
                    This is how your profile looks to everyone else. Only rankings you&apos;ve made
                    public appear here —{" "}
                    <Link href="/history" className="text-accent underline underline-offset-2">
                        manage them, and your username, in your history
                    </Link>
                    .
                </p>
            )}
            {!viewerId && (
                <p className="mb-8 text-sm text-fg-muted">
                    <Link
                        href={`/signin?callbackUrl=${encodeURIComponent(`/u/${person.username ?? person.id}`)}`}
                        className="text-accent underline underline-offset-2"
                    >
                        Sign in
                    </Link>{" "}
                    to follow {name} and to rank their lists yourself.
                </p>
            )}

            <h2 className="mb-4 text-lg font-semibold">Public rankings</h2>
            {rankings.length === 0 ? (
                <p className="card p-6 text-sm text-fg-muted">
                    {isSelf
                        ? "You haven't made any of your rankings public yet."
                        : `${name} hasn't made any rankings public.`}
                </p>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                    {rankings.map((r) => (
                        <PublicRankingCard key={r.id} ranking={r} showOwner={false} />
                    ))}
                </div>
            )}
        </div>
    );
}
