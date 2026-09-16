/* eslint-disable @next/next/no-img-element --
   Google account avatars are 36px and decorative, and they come from whatever
   host Google hands us. next/image would mean another entry in next.config's
   remotePatterns for every such host, and an optimisation round trip, to save
   nothing measurable on an image this size. */
import Link from "next/link";
import type { PersonSummary } from "@/lib/people";

/** One person, in the directory and the friends list. Name and a masked
 * address only -- see lib/people.ts for why the real email never leaves the
 * server. */
export default function PersonRow({ person, badge }: { person: PersonSummary; badge?: string }) {
    return (
        <Link
            href={`/u/${person.id}`}
            className="card flex items-center gap-3 p-3 transition-colors hover:border-accent/50 hover:bg-bg-soft-2"
        >
            {person.image ? (
                <img src={person.image} alt="" width={36} height={36} className="rounded-full" />
            ) : (
                <span
                    aria-hidden="true"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-bg-soft-2 text-sm font-bold text-fg-muted"
                >
                    {(person.name ?? "?").trim().charAt(0).toUpperCase() || "?"}
                </span>
            )}
            <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-fg">
                    {person.name ?? "Someone"}
                    {badge && <span className="ml-2 text-xs font-normal text-accent">{badge}</span>}
                </span>
                <span className="block truncate text-xs text-fg-muted">{person.maskedEmail}</span>
            </span>
            <span className="shrink-0 text-xs text-fg-muted">
                {person.publicRankings} public
            </span>
        </Link>
    );
}
