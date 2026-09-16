import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { hasDatabase } from "@/lib/db";
import { isAuthConfigured } from "@/lib/authConfig";
import { getPerson } from "@/lib/people";
import { isFriend } from "@/lib/friends";
import { listPublicTournamentsByUser } from "@/lib/queries";
import FriendButton from "@/components/FriendButton";
import PublicRankingCard from "@/components/PublicRankingCard";
import SharingUnavailable from "@/components/SharingUnavailable";

export const dynamic = "force-dynamic";

export default async function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
    if (!hasDatabase || !isAuthConfigured()) return <SharingUnavailable what="Profiles" />;

    const { id } = await params;
    const personId = Number(id);
    // A non-numeric id can't be a user (ids are SERIAL), so this is a 404
    // rather than a query -- and it keeps a garbage path out of the database.
    if (!Number.isInteger(personId) || personId <= 0) notFound();

    const person = await getPerson(personId);
    if (!person) notFound();

    const session = await auth();
    const viewerId = session?.user?.id ?? null;
    const isSelf = viewerId === personId;

    const [rankings, following] = await Promise.all([
        listPublicTournamentsByUser(personId),
        viewerId && !isSelf ? isFriend(viewerId, personId) : Promise.resolve(false),
    ]);

    const name = person.name?.trim() || "Someone";

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
                    <p className="text-sm text-fg-muted">{person.maskedEmail}</p>
                    <p className="mt-1 text-sm text-fg-muted">
                        {person.publicRankings} public {person.publicRankings === 1 ? "ranking" : "rankings"}
                    </p>
                </div>
            </header>

            {viewerId && !isSelf && (
                <div className="mb-8">
                    <FriendButton personId={personId} personName={name} initiallyFriend={following} />
                </div>
            )}
            {isSelf && (
                <p className="mb-8 rounded-lg border border-border bg-bg-soft-2 px-4 py-3 text-sm text-fg-muted">
                    This is how your profile looks to everyone else. Only rankings you&apos;ve made
                    public appear here —{" "}
                    <Link href="/history" className="text-accent underline underline-offset-2">
                        manage them in your history
                    </Link>
                    .
                </p>
            )}
            {!viewerId && (
                <p className="mb-8 text-sm text-fg-muted">
                    <Link
                        href={`/signin?callbackUrl=${encodeURIComponent(`/u/${personId}`)}`}
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
