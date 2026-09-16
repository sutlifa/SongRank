import Link from "next/link";
import type { PublicTournamentSummary } from "@/lib/queries";

/** One public ranking, on Browse and on a profile. */
export default function PublicRankingCard({
    ranking,
    showOwner = true,
}: {
    ranking: PublicTournamentSummary;
    showOwner?: boolean;
}) {
    return (
        <Link
            href={`/r/${ranking.id}`}
            className="card flex flex-col gap-2 p-4 transition-colors hover:border-accent/50 hover:bg-bg-soft-2"
        >
            <h3 className="font-semibold text-fg">{ranking.name}</h3>
            {showOwner && (
                <p className="text-sm text-fg-muted">by {ranking.owner_name ?? "Someone"}</p>
            )}
            <p className="mt-auto pt-1 text-xs text-fg-muted">
                {ranking.songs} songs · {ranking.votes} matchups played
            </p>
        </Link>
    );
}
