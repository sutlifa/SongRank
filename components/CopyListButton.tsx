import Link from "next/link";

/**
 * "Use this list" on someone else's public ranking.
 *
 * A link into the ordinary build screen, not a button that creates something.
 * Copying used to POST a new ranking straight from the database and drop you
 * on your first matchup -- which meant you inherited their depth, could not
 * rename it, could not add or remove a song, and could not swap a recording
 * you disagreed with. A copied list is a starting point, not an inheritance.
 *
 * Routing through /new?copy=<id> makes it exactly a ready-made list: same
 * build screen, same pre-flight check with its per-song "Change version", same
 * depth choice, same shuffle-and-save. Nothing downstream can tell the three
 * apart, so there is one path to keep working rather than two.
 *
 * A server component: there is nothing to do on the client, and the ranking is
 * only created when the visitor finishes the pre-flight screen -- so a stray
 * click here leaves nothing behind.
 */
export default function CopyListButton({
    tournamentId,
    songCount,
    signedIn,
}: {
    tournamentId: string;
    songCount: number;
    signedIn: boolean;
}) {
    return (
        <div className="w-full">
            <p className="mb-2 text-sm font-semibold">Rank these {songCount} songs yourself</p>
            <p className="mb-3 text-sm text-fg-muted">
                Opens as your own list, ready to edit — add songs, drop the ones you don&apos;t know,
                swap a recording, rename it and pick how thorough you want to be. Their picks
                aren&apos;t copied, and nothing you do can change their ranking.
            </p>
            {signedIn ? (
                <Link href={`/new?copy=${encodeURIComponent(tournamentId)}`} className="btn-primary">
                    Use this list
                </Link>
            ) : (
                <Link
                    href={`/signin?callbackUrl=${encodeURIComponent(`/new?copy=${tournamentId}`)}`}
                    className="btn-primary"
                >
                    Sign in to rank these songs
                </Link>
            )}
        </div>
    );
}
