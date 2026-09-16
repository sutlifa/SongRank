import Link from "next/link";
import { estimateMatchups } from "@/lib/ranking";
import type { StarterList } from "@/lib/starterLists";

/**
 * One ready-made list, on the home page and on /starters.
 *
 * A plain server component: the whole card is a link, so there is nothing for
 * the client bundle to do here. Clicking it lands on /new with the songs
 * already in the review table -- see components/NewTournament.tsx's `starter`
 * prop for the handoff.
 *
 * The matchup estimate is on the card on purpose. "Rank these" on a 30-song
 * list is a couple of hundred decisions at the default depth, and finding that
 * out after committing is how someone abandons a ranking halfway. Saying it up
 * front is the same courtesy /new already extends before its own Start button.
 */
export default function StarterCard({ list }: { list: StarterList }) {
    const matchups = estimateMatchups(list.songs.length, "thorough");

    return (
        <Link
            href={`/new?starter=${encodeURIComponent(list.id)}`}
            className="card group flex flex-col gap-2 p-5 transition-colors hover:border-accent/50 hover:bg-bg-soft-2"
        >
            <span className="text-2xl leading-none" aria-hidden="true">
                {list.emoji}
            </span>
            <h3 className="font-semibold text-fg group-hover:text-accent">{list.title}</h3>
            <p className="text-sm leading-relaxed text-fg-muted">{list.blurb}</p>
            <p className="mt-auto pt-2 text-xs text-fg-muted">
                {list.songs.length} songs · ~{matchups.toLocaleString()} matchups
            </p>
        </Link>
    );
}
