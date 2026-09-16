import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { hasDatabase } from "@/lib/db";
import { isAuthConfigured } from "@/lib/authConfig";
import { getPublicTournament, listComparableTournaments } from "@/lib/queries";
import { deriveTournament } from "@/lib/tournamentEngine";
import SongArt from "@/components/SongArt";
import CopyListButton from "@/components/CopyListButton";
import SharingUnavailable from "@/components/SharingUnavailable";

export const dynamic = "force-dynamic";

/**
 * Someone else's public ranking, read-only.
 *
 * A separate route from /t/[id] on purpose, and not a mode of it. /t/[id] is
 * the interactive player: it loads through useTournamentLoader, writes to
 * localStorage and autosaves every vote back to the server. Pointing that
 * machinery at a ranking you don't own and hoping a flag keeps it read-only
 * would put "can a stranger's vote reach my row?" one forgotten branch away
 * from being true. This page renders server-side from a query that filters on
 * `visibility = 'public'` and has no way to write anything at all.
 */
export default async function PublicRankingPage({ params }: { params: Promise<{ id: string }> }) {
    if (!hasDatabase || !isAuthConfigured()) return <SharingUnavailable what="Shared rankings" />;

    const { id } = await params;
    const row = await getPublicTournament(id);
    // Covers "no such ranking" and "exists but is private" with one answer, so
    // the page can't be used to discover that a private ranking exists.
    if (!row) notFound();

    const session = await auth();
    const viewerId = session?.user?.id ?? null;
    const isOwner = viewerId === row.owner_id;

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
    const owner = row.owner_name?.trim() || "Someone";

    // Rankings of the viewer's own that cover this same list -- their copies
    // of it, and the original if it is theirs. This is what turns "compare our
    // picks" into a link rather than an instruction to go and find the right
    // one.
    const mine = viewerId ? await listComparableTournaments(viewerId, row.id) : [];
    const comparable = mine.filter((m) => m.id !== row.id && m.votes > 0);

    return (
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
            <header className="mb-6">
                <h1 className="text-xl font-bold sm:text-2xl">{row.name}</h1>
                <p className="mt-1 text-sm text-fg-muted">
                    by{" "}
                    <Link href={`/u/${row.owner_id}`} className="text-accent underline underline-offset-2">
                        {owner}
                    </Link>{" "}
                    · {row.songs.length} songs · {row.votes.length} matchups played
                    {derived.status !== "complete" && " · still in progress"}
                </p>
            </header>

            <div className="card mb-8 flex flex-wrap items-center gap-3 p-4">
                {isOwner ? (
                    <p className="text-sm text-fg-muted">
                        This is your own ranking, as everyone else sees it.{" "}
                        <Link href={`/t/${row.id}`} className="text-accent underline underline-offset-2">
                            Open it
                        </Link>
                    </p>
                ) : (
                    <>
                        <CopyListButton tournamentId={row.id} signedIn={viewerId !== null} />
                        <p className="text-sm text-fg-muted">
                            Copies the song list into a ranking of your own. Their picks aren&apos;t
                            copied, and nothing you do can change their ranking.
                        </p>
                    </>
                )}
            </div>

            {comparable.length > 0 && (
                <div className="card mb-8 p-4">
                    <p className="mb-2 text-sm font-semibold">Compare your picks with {owner}&apos;s</p>
                    <ul className="flex flex-wrap gap-2">
                        {comparable.map((m) => (
                            <li key={m.id}>
                                <Link href={`/compare/${m.id}/${row.id}`} className="btn-secondary !py-1.5 text-xs">
                                    {m.name}
                                </Link>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <ol className="space-y-2">
                {derived.standings.map((standing) => {
                    const song = songById.get(standing.songId);
                    if (!song) return null;
                    const isChampion = song.id === derived.championId;
                    return (
                        <li key={song.id} className={`card flex items-center gap-3 p-3 ${isChampion ? "border-accent/50" : ""}`}>
                            <span className="w-7 shrink-0 text-center font-bold text-fg-muted">
                                {isChampion ? "👑" : standing.rank}
                            </span>
                            <SongArt title={song.title} artworkUrl={song.artworkUrl} size={44} />
                            <div className="min-w-0 flex-1">
                                <p className="truncate font-medium" title={song.title}>
                                    {song.title}
                                </p>
                                <p className="truncate text-sm text-fg-muted" title={song.artist}>
                                    {song.artist || "Unknown artist"}
                                </p>
                            </div>
                            <span className="shrink-0 font-mono text-xs text-fg-muted">
                                {standing.recordLabel}
                            </span>
                        </li>
                    );
                })}
            </ol>
        </div>
    );
}
