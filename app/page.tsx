import Link from "next/link";

export default function HomePage() {
    return (
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-24">
            <div className="space-y-6 text-center">
                <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
                    Rank any list of songs, <span className="text-accent">head to head</span>.
                </h1>
                <p className="mx-auto max-w-xl text-lg leading-relaxed text-fg-muted">
                    Paste a list, search for songs, or import a Spotify playlist. Listen to a clip of
                    each, vote on one matchup at a time, and get a real ranking out the other end —
                    powered by the same Swiss-tournament pairing used in competitive card games.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                    <Link href="/new" className="btn-primary text-base">
                        Start a tournament
                    </Link>
                    <Link href="/history" className="btn-secondary text-base">
                        Your history
                    </Link>
                </div>
            </div>

            <div className="mt-16 grid gap-4 sm:grid-cols-3">
                <Step
                    n={1}
                    title="Build your list"
                    body="Paste song names, search and add them one by one, or drop in a Spotify playlist link."
                />
                <Step
                    n={2}
                    title="Vote, one pair at a time"
                    body="Two songs, a 15-second clip of each. Pick a winner. No draws, no ties — undo any misclick."
                />
                <Step
                    n={3}
                    title="Get a real ranking"
                    body="A Swiss bracket settles it in a handful of rounds. Export as a playlist, CSV, or plain text."
                />
            </div>

            <p className="mt-12 text-center text-sm text-fg-muted">
                No account needed — sign in only if you want to save a tournament and pick it up later.
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
