import NewTournament from "@/components/NewTournament";
import { isAuthConfigured } from "@/lib/authConfig";
import { loadStarter } from "@/lib/charts";

export const metadata = { title: "Create new ranking" };

/**
 * `searchParams` is a Promise in this version of Next -- see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md.
 * Awaiting it is what makes this route dynamic, which is correct here: the
 * starter may be the live chart, and the value varies per request either way.
 */
export default async function NewTournamentPage({
    searchParams,
}: {
    searchParams: Promise<{ starter?: string }>;
}) {
    const { starter: starterId } = await searchParams;

    // An unknown slug (or a chart that couldn't be fetched) falls through to
    // the ordinary empty build screen rather than an error. Someone who
    // followed a stale link still lands somewhere they can use, which beats a
    // 404 for a parameter that is only ever a convenience.
    const starter = starterId ? await loadStarter(starterId) : null;

    return (
        <NewTournament
            authEnabled={isAuthConfigured()}
            starter={starter ? { name: starter.title, songs: starter.songs } : null}
        />
    );
}
