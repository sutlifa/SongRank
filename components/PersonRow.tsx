/* eslint-disable @next/next/no-img-element --
   Google account avatars are 36px and decorative, and they come from whatever
   host Google hands us. next/image would mean another entry in next.config's
   remotePatterns for every such host, and an optimisation round trip, to save
   nothing measurable on an image this size. */
import Link from "next/link";
import { profilePath } from "@/lib/username";
import type { PersonSummary } from "@/lib/people";

/** One person, in the directory and the friends list. Name and a masked
 * address only -- see lib/people.ts for why the real email never leaves the
 * server. */
export default function PersonRow({ person, badge }: { person: PersonSummary; badge?: string }) {
    return (
        <Link
            href={profilePath(person)}
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
                <span className="block truncate text-xs text-fg-muted">
                    {person.username ? (
                        `@${person.username}`
                    ) : (
                        // No handle yet. Saying so beats an empty line, and it
                        // is also the nudge that gets people to pick one --
                        // which is what makes anybody findable at all.
                        <span className="italic">no username yet</span>
                    )}
                </span>
            </span>
            <span className="shrink-0 text-xs text-fg-muted">
                {person.publicRankings} public
            </span>
        </Link>
    );
}
