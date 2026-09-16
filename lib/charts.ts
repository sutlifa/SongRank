// lib/charts.ts
//
// The one starter list that isn't written down: whatever is charting right
// now. Everything else in lib/starterLists.ts is fixed text and will read the
// same in two years; "current hot songs" is only worth offering if it is
// actually current, so it comes from Apple's public chart feed at request time.
//
// Same vendor as the previews the whole app already runs on (see
// lib/itunes.ts), and keyless like that one -- no secret to add to Vercel, no
// account to keep alive, nothing to rotate. It is a plain public JSON
// document.
//
// ## Failing is a normal outcome here
//
// This is a nice-to-have on a page whose other ten lists are hardcoded and
// cannot fail. So every failure path -- network down, feed moved, schema
// changed, a country code with no chart -- returns null, and the caller simply
// doesn't show the card. Nothing here throws, and nothing here is allowed to
// take a page down with it.

import { getCuratedStarter } from "./starterLists";
import type { StarterList, StarterSong } from "./starterLists";

/** The slug this list answers to, at /new?starter=charts. */
export const CHART_STARTER_ID = "charts";

/** How many chart entries to take. 30 matches the hand-written lists, which is
 * about 190 matchups at Thorough -- a real session, not an afternoon. */
const CHART_SIZE = 30;

/**
 * Six hours. The chart itself updates daily, so this is already more eager
 * than the data warrants; it is set short enough that the page is never
 * embarrassingly stale and long enough that a burst of visitors costs one
 * upstream request between them rather than one each.
 *
 * Next 16 does not cache `fetch` unless asked (see
 * node_modules/next/dist/docs/01-app/03-api-reference/04-functions/fetch.md),
 * so without this every render would hit Apple directly.
 */
const REVALIDATE_SECONDS = 60 * 60 * 6;

const FEED_URL = `https://rss.applemarketingtools.com/api/v2/us/music/most-played/${CHART_SIZE}/songs.json`;

/** The two fields we need, and nothing else. Anything failing this shape is
 * dropped rather than guessed at -- a chart entry with no title is not a song
 * we can look up, and half a song in the list is worse than a shorter list. */
function toSong(entry: unknown): StarterSong | null {
    if (typeof entry !== "object" || entry === null) return null;
    const { name, artistName } = entry as { name?: unknown; artistName?: unknown };
    if (typeof name !== "string" || typeof artistName !== "string") return null;
    const title = name.trim();
    const artist = artistName.trim();
    if (!title || !artist) return null;
    return { title, artist };
}

/**
 * The live chart as a starter list, or null if it can't be had right now.
 *
 * Null is not an error to report; it means "don't offer this one today". The
 * caller renders the other lists and says nothing, because a visitor who never
 * knew this card existed has lost nothing.
 */
export async function fetchChartStarter(): Promise<StarterList | null> {
    try {
        const res = await fetch(FEED_URL, {
            next: { revalidate: REVALIDATE_SECONDS },
            signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return null;

        const data: unknown = await res.json();
        const results = (data as { feed?: { results?: unknown } } | null)?.feed?.results;
        if (!Array.isArray(results)) return null;

        const songs = results.map(toSong).filter((s): s is StarterSong => s !== null);
        // Two is the engine's own minimum for a ranking, but a chart that came
        // back with three usable rows is a broken feed, not a short chart --
        // better to show nothing than a card promising the top songs and
        // delivering four.
        if (songs.length < 10) return null;

        return {
            id: CHART_STARTER_ID,
            title: "Charting Right Now",
            blurb: `The ${songs.length} most-played songs on Apple Music today.`,
            category: "featured",
            emoji: "🔥",
            songs,
        };
    } catch {
        return null;
    }
}

/**
 * Resolves a starter id from either source: the fixed lists or the live chart.
 *
 * It lives here rather than in lib/starterLists.ts to keep the dependency
 * pointing one way -- the network module may know about the pure data module,
 * never the reverse. Putting this the other way round would drag a `fetch` into
 * the one file that is deliberately free of them.
 *
 * Returns null for an unknown id and for a chart that couldn't be fetched, and
 * the caller treats both the same way: there is no list here, show the 404-ish
 * empty state. A visitor cannot tell a typo'd slug from a chart outage, and
 * doesn't need to.
 */
export async function loadStarter(id: string): Promise<StarterList | null> {
    if (id === CHART_STARTER_ID) return fetchChartStarter();
    return getCuratedStarter(id);
}
