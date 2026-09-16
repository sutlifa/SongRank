import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { hasDatabase } from "@/lib/db";
import { isAuthConfigured } from "@/lib/authConfig";
import { getComparableTournament } from "@/lib/queries";
import { deriveTournament } from "@/lib/tournamentEngine";
import { compareRankings, describeCorrelation, type CompareEntry } from "@/lib/compare";
import SharingUnavailable from "@/components/SharingUnavailable";
import type { TournamentRow } from "@/lib/queries";

export const metadata = { title: "Compare rankings" };
export const dynamic = "force-dynamic";

/** Replays a stored row through the engine and flattens it to what
 * lib/compare.ts needs: rank, plus the text to show for each song. */
function toEntries(row: TournamentRow): CompareEntry[] {
    const derived = deriveTournament({
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        clipSeconds: row.clip_seconds,
        format: row.format,
        depth: row.depth ?? undefined,
        songs: row.songs,
        votes: row.votes,
    });
    const songById = new Map(row.songs.map((s) => [s.id, s]));
    return derived.standings.flatMap((standing) => {
        const song = songById.get(standing.songId);
        if (!song) return [];
        return [{ songId: song.id, title: song.title, artist: song.artist, rank: standing.rank }];
    });
}

export default async function ComparePage({
    params,
}: {
    params: Promise<{ mine: string; theirs: string }>;
}) {
    if (!hasDatabase || !isAuthConfigured()) return <SharingUnavailable what="Comparing rankings" />;

    const { mine: mineId, theirs: theirsId } = await params;
    const session = await auth();
    const viewerId = session?.user?.id ?? null;

    // Both sides go through the same check: yours, or anyone's public one.
    // A private ranking belonging to someone else resolves to null here and
    // the page 404s, so pairing a stranger's private id with one of your own
    // reads nothing.
    const [left, right] = await Promise.all([
        getComparableTournament(viewerId, mineId),
        getComparableTournament(viewerId, theirsId),
    ]);
    if (!left || !right) notFound();

    const comparison = compareRankings(toEntries(left), toEntries(right));
    const leftOwner = left.owner_id === viewerId ? "You" : left.owner_name?.trim() || "Someone";
    const rightOwner = right.owner_id === viewerId ? "You" : right.owner_name?.trim() || "Someone";

    const pct = comparison.correlation === null ? null : Math.round(comparison.correlation * 100);

    return (
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
            <h1 className="text-2xl font-bold sm:text-3xl">Compare picks</h1>
            <p className="mt-1 text-sm text-fg-muted">
                <span className="font-medium text-fg">{left.name}</span> ({leftOwner}) vs{" "}
                <span className="font-medium text-fg">{right.name}</span> ({rightOwner})
            </p>

            <div className="card mt-6 p-5">
                <p className="text-lg font-semibold">{describeCorrelation(comparison.correlation)}</p>
                <p className="mt-1 text-sm text-fg-muted">
                    {comparison.shared.length} songs in common
                    {pct !== null && ` · rank correlation ${(pct / 100).toFixed(2)}`}
                    {comparison.agreements > 0 &&
                        ` · ${comparison.agreements} placed at exactly the same spot`}
                </p>
                {(comparison.onlyMine.length > 0 || comparison.onlyTheirs.length > 0) && (
                    <p className="mt-2 text-xs text-fg-muted">
                        Only compared on songs both rankings contain
                        {comparison.onlyMine.length > 0 && ` · ${comparison.onlyMine.length} only in ${left.name}`}
                        {comparison.onlyTheirs.length > 0 &&
                            ` · ${comparison.onlyTheirs.length} only in ${right.name}`}
                        . Ranks below are positions within the shared songs, not within either full list.
                    </p>
                )}
            </div>

            {comparison.shared.length === 0 ? (
                <p className="card mt-6 p-6 text-sm text-fg-muted">
                    These two rankings have no songs in common, so there is nothing to compare. Copying
                    a list from someone&apos;s ranking is the reliable way to end up with the same
                    songs on both sides.
                </p>
            ) : (
                <>
                    {comparison.biggestDisagreements.length > 0 && (
                        <section className="mt-8">
                            <h2 className="mb-3 text-lg font-semibold">Biggest disagreements</h2>
                            <ul className="space-y-2">
                                {comparison.biggestDisagreements.map((song) => (
                                    <li key={`${song.title}-${song.artist}`} className="card p-3">
                                        <p className="truncate font-medium" title={song.title}>
                                            {song.title}
                                        </p>
                                        <p className="truncate text-sm text-fg-muted">
                                            {song.artist || "Unknown artist"}
                                        </p>
                                        <p className="mt-1 text-sm">
                                            <span className="text-fg-muted">{leftOwner}:</span> #{song.mine}
                                            <span className="mx-2 text-fg-muted">·</span>
                                            <span className="text-fg-muted">{rightOwner}:</span> #{song.theirs}
                                            <span className="ml-2 font-semibold text-accent">
                                                {Math.abs(song.delta)} place{Math.abs(song.delta) === 1 ? "" : "s"} apart
                                            </span>
                                        </p>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}

                    <section className="mt-8">
                        <h2 className="mb-3 text-lg font-semibold">Every shared song</h2>
                        <div className="card overflow-hidden">
                            <table className="w-full text-sm">
                                <thead className="border-b border-border bg-bg-soft-2 text-xs uppercase text-fg-muted">
                                    <tr>
                                        <th scope="col" className="px-3 py-2 text-left font-medium">Song</th>
                                        <th scope="col" className="px-2 py-2 text-right font-medium">{leftOwner}</th>
                                        <th scope="col" className="px-2 py-2 text-right font-medium">{rightOwner}</th>
                                        <th scope="col" className="px-3 py-2 text-right font-medium">Diff</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {comparison.shared.map((song) => (
                                        <tr key={`${song.title}-${song.artist}`} className="border-b border-border last:border-0">
                                            <td className="max-w-0 px-3 py-2">
                                                <span className="block truncate font-medium" title={song.title}>
                                                    {song.title}
                                                </span>
                                                <span className="block truncate text-xs text-fg-muted">
                                                    {song.artist || "Unknown artist"}
                                                </span>
                                            </td>
                                            <td className="px-2 py-2 text-right font-mono">{song.mine}</td>
                                            <td className="px-2 py-2 text-right font-mono">{song.theirs}</td>
                                            <td
                                                className={`px-3 py-2 text-right font-mono ${
                                                    song.delta === 0 ? "text-fg-muted" : "text-accent"
                                                }`}
                                            >
                                                {song.delta === 0 ? "—" : song.delta > 0 ? `+${song.delta}` : song.delta}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <p className="mt-2 text-xs text-fg-muted">
                            A positive difference means {leftOwner === "You" ? "you" : leftOwner} ranked it
                            higher than {rightOwner === "You" ? "you" : rightOwner} did.
                        </p>
                    </section>
                </>
            )}

            <p className="mt-10 text-center text-sm text-fg-muted">
                <Link href="/browse" className="text-accent underline underline-offset-2">
                    Back to browse
                </Link>
            </p>
        </div>
    );
}
