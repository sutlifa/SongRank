import Link from "next/link";
import StarterCard from "@/components/StarterCard";
import { fetchChartStarter } from "@/lib/charts";
import {
    CURATED_STARTERS,
    STARTER_CATEGORIES,
    STARTER_CATEGORY_BLURBS,
    STARTER_CATEGORY_LABELS,
    type StarterList,
} from "@/lib/starterLists";

export const metadata = {
    title: "Ready-made lists",
    description: "Start a ranking from a ready-made list — all-time greats, a genre, a decade, or what's charting now.",
};

export default async function StartersPage() {
    // The live chart may be unavailable (see lib/charts.ts) -- in which case
    // this page is simply the fixed lists, with nothing said about it.
    const chart = await fetchChartStarter();
    const all: StarterList[] = chart ? [chart, ...CURATED_STARTERS] : [...CURATED_STARTERS];

    return (
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
            <h1 className="mb-2 text-2xl font-bold sm:text-3xl">Ready-made lists</h1>
            <p className="mb-10 max-w-2xl text-sm leading-relaxed text-fg-muted">
                Pick one and start voting — no typing, no playlist to dig up. Every list opens in the
                normal build screen first, so you can add songs, drop the ones you don&apos;t know,
                and rename it before anything starts.
            </p>

            <div className="space-y-12">
                {STARTER_CATEGORIES.map((category) => {
                    const lists = all.filter((l) => l.category === category);
                    if (lists.length === 0) return null;
                    return (
                        <section key={category}>
                            <h2 className="text-lg font-semibold">{STARTER_CATEGORY_LABELS[category]}</h2>
                            <p className="mb-4 text-sm text-fg-muted">{STARTER_CATEGORY_BLURBS[category]}</p>
                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                {lists.map((list) => (
                                    <StarterCard key={list.id} list={list} />
                                ))}
                            </div>
                        </section>
                    );
                })}
            </div>

            <p className="mt-12 text-center text-sm text-fg-muted">
                Got your own list?{" "}
                <Link href="/new" className="text-accent underline underline-offset-2">
                    Paste it or search for songs
                </Link>
                .
            </p>
        </div>
    );
}
