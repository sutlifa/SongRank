import Link from "next/link";
import StarterCard from "@/components/StarterCard";
import { fetchChartStarter } from "@/lib/charts";
import { CURATED_STARTERS, type StarterList } from "@/lib/starterLists";

/** How many ready-made lists the home page shows before "browse all". Six
 * fills two clean rows of three and still leaves the page scannable; the rest
 * are one click away on /starters. */
const FEATURED_COUNT = 6;

export default async function HomePage() {
    // The live chart leads when it's available, because "what's charting right
    // now" is the one list that can't be got any other way. When it isn't (see
    // lib/charts.ts), the fixed lists simply close the gap and nothing on the
    // page refers to something that isn't there.
    const chart = await fetchChartStarter();
    const featured: StarterList[] = (chart ? [chart, ...CURATED_STARTERS] : [...CURATED_STARTERS]).slice(
        0,
        FEATURED_COUNT
    );
    const total = CURATED_STARTERS.length + (chart ? 1 : 0);

    return (
        <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
            <div className="space-y-6 text-center">
                <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
                    Rank any list of songs, <span className="text-accent">head to head</span>.
                </h1>
                <p className="mx-auto max-w-xl text-lg leading-relaxed text-fg-muted">
                    Pick a ready-made list or bring your own. Listen to a clip of each, vote on one
                    matchup at a time, and get a real ranking out the other end — every matchup
                    chosen to be the one that teaches the ranking the most.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                    <Link href="/starters" className="btn-primary text-base">
                        Pick a list to rank
                    </Link>
                    <Link href="/new" className="btn-secondary text-base">
                        Build my own
                    </Link>
                </div>
            </div>

            <section className="mt-16">
                <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
                    <div>
                        <h2 className="text-xl font-bold">Start with a ready-made list</h2>
                        <p className="mt-1 text-sm text-fg-muted">
                            No typing, no playlist to dig up. Edit it before you start if you want.
                        </p>
                    </div>
                    <Link
                        href="/starters"
                        className="text-sm text-accent underline underline-offset-2 hover:opacity-80"
                    >
                        Browse all {total} →
                    </Link>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {featured.map((list) => (
                        <StarterCard key={list.id} list={list} />
                    ))}
                </div>
            </section>

            <div className="mt-20 grid gap-4 sm:grid-cols-3">
                <Step
                    n={1}
                    title="Build your list"
                    body="Pick a ready-made list, paste song names, or search and add them one by one."
                />
                <Step
                    n={2}
                    title="Vote, one pair at a time"
                    body="Two songs, a clip of each. Pick a winner — or flip a coin when you can't separate them. Undo any misclick."
                />
                <Step
                    n={3}
                    title="Get a real ranking"
                    body="Stop any time and get a valid ranking, or let it settle fully. Export as a playlist, CSV, or plain text."
                />
            </div>

            <p className="mt-12 text-center text-sm text-fg-muted">
                No account needed — sign in only if you want to save a ranking and pick it up later.
            </p>
        </div>
    );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
    return (
        <div className="card p-5">
            <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-bg-soft-2 text-sm font-bold text-accent">
                {n}
            </div>
            <h2 className="mb-1 font-semibold">{title}</h2>
            <p className="text-sm leading-relaxed text-fg-muted">{body}</p>
        </div>
    );
}
