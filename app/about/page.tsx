import Link from "next/link";

export const metadata = {
    title: "About",
    description: "How SongRank turns a list of songs into a ranking, and where the audio comes from.",
};

export default function AboutPage() {
    return (
        <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-14">
            <h1 className="mb-3 text-2xl font-bold sm:text-3xl">About SongRank</h1>
            <p className="mb-8 text-base leading-relaxed text-fg-muted">
                SongRank turns a list of songs into a ranked list by asking you the only question
                you can actually answer reliably: of these two, which is better? Everything else is
                bookkeeping.
            </p>

            <section className="mb-8">
                <h2 className="mb-2 text-lg font-semibold">How it works</h2>
                <p className="mb-3 text-sm leading-relaxed text-fg-muted">
                    Start from a ready-made list &mdash; all-time greats, a genre, a decade, or
                    what&apos;s charting right now &mdash; or build your own by pasting a list or
                    searching for songs one at a time. A ready-made list is just a starting point:
                    it opens in the same build screen, where you can add to it, drop anything you
                    don&apos;t know and rename it. Each song is matched against Apple&apos;s music
                    catalogue to pull in artwork and a preview clip.
                </p>
                <p className="text-sm leading-relaxed text-fg-muted">
                    Then you vote. Two songs at a time, with a short clip of each so you can refresh
                    your memory before deciding. When a matchup is genuinely too close to call,
                    &ldquo;flip a coin&rdquo; records it as a tie instead of forcing a pick &mdash;
                    neither song gains or loses ground, and you move on. When the matchups are done
                    you get a full ranking, not just a winner, and you can export it.
                </p>
            </section>

            <section className="mb-8">
                <h2 className="mb-2 text-lg font-semibold">Sharing and comparing</h2>
                <p className="mb-3 text-sm leading-relaxed text-fg-muted">
                    Rankings are private unless you say otherwise. Make one public and it appears on
                    Browse, where anyone can read it, copy its song list, and rank the same songs
                    themselves — their votes are their own, and nothing they do can change your
                    ranking. Their copy is a template, not a duplicate: they can add
                    and remove songs, swap any of them for a different recording, rename it and
                    choose how thorough their own ranking should be, rather than inheriting your
                    answers.
                </p>
                <p className="text-sm leading-relaxed text-fg-muted">
                    Once you have both ranked the same list, comparing the two shows how closely you
                    agree, which songs you disagree most sharply about, and every song side by side.
                    Following someone is one-way and simply puts their public rankings first on your
                    Browse page. Pick a username and friends can find you by it &mdash; neither of
                    you ever has to hand out an email address.
                </p>
            </section>

            <section className="mb-8">
                <h2 className="mb-2 text-lg font-semibold">Why pairwise ratings, not Swiss or a bracket</h2>
                <p className="mb-3 text-sm leading-relaxed text-fg-muted">
                    A knockout bracket eliminates half the field every round. That finds a winner
                    quickly, but it tells you almost nothing about the rest: a song knocked out in
                    round one by the eventual champion is ranked no higher than one knocked out by
                    the worst song in the field. Most of your votes end up discarded.
                </p>
                <p className="mb-3 text-sm leading-relaxed text-fg-muted">
                    SongRank used to run on the Swiss system — the same format Magic: The Gathering
                    tournaments use — and Swiss is a real improvement over a bracket. But it still
                    isn&apos;t enough, and the reason is arithmetic rather than opinion. Producing a
                    provably correct order of <em>n</em> items needs at least log&#8322;(n!)
                    comparisons — that is how many yes/no answers it takes to distinguish between
                    all the possible orderings of the list. For 256 songs, log&#8322;(256!) ≈ 1,684.
                    Eight rounds of Swiss on 256 songs is only 8 × 128 = 1,024 comparisons — short of
                    that floor before you even count that Swiss also <em>wastes</em> comparisons
                    re-pairing songs whose relative order a smarter system would already treat as
                    settled.
                </p>
                <p className="text-sm leading-relaxed text-fg-muted">
                    SongRank now uses an <strong className="text-fg">adaptive pairwise ranking</strong>{" "}
                    engine instead. Every song carries a rating and an uncertainty score, both
                    updated after each vote — a surprising result (an underdog winning) moves a
                    rating more than an expected one, and a song&apos;s uncertainty shrinks the more
                    it plays. Rather than following a fixed bracket or round schedule, every single
                    matchup is chosen fresh: whichever pair currently has the closest ratings and the
                    most combined uncertainty, because that is the comparison whose answer teaches
                    the engine the most. A blowout between the best and worst songs on your list
                    would confirm what the ratings already predict; two closely-matched songs are
                    where a vote actually moves the needle.
                </p>
            </section>

            <section className="mb-8">
                <h2 className="mb-2 text-lg font-semibold">How many matchups, and when it stops</h2>
                <p className="mb-3 text-sm leading-relaxed text-fg-muted">
                    On the build step you pick a depth — <strong className="text-fg">Quick</strong>,{" "}
                    <strong className="text-fg">Balanced</strong>, or{" "}
                    <strong className="text-fg">Thorough</strong> (the default), each shown with its
                    estimated matchup count before you commit. The target scales with your list size
                    as roughly <code className="rounded bg-bg-soft-2 px-1 py-0.5 text-xs">1.25 × n × log&#8322;n</code>{" "}
                    matchups at Thorough — about 30 for 8 songs, 480 for 64, 2,560 for the full 256.
                    A list of 6 songs or fewer just plays every pair once, which is exact and cheaper
                    than being clever about it.
                </p>
                <p className="mb-3 text-sm leading-relaxed text-fg-muted">
                    You are never required to reach that target. The ranking is valid after any
                    number of votes — stop whenever you want and you still get a complete, ordered
                    list, it just gets more confident the longer you play. A progress readout shows
                    what fraction of all the pairs in your list the engine can already order
                    confidently &mdash; read it as how much of the final answer is decided if you
                    stop right now. A long list finishes short of 100%, which is honest: a few
                    thousand comparisons genuinely cannot pin down 200 songs to the last adjacent
                    pair. A small or lopsided list, on the other hand, can finish well before its
                    estimated matchup count, once every neighbour in the ranking is clearly
                    separated. A close, evenly-matched list
                    tends to use its full budget, because that is exactly when more votes keep being
                    informative.
                </p>
                <p className="text-sm leading-relaxed text-fg-muted">
                    Every one of those matchups is chosen the same way, right to the end. A ranking
                    used to finish with a short playoff between the leading few songs, and that was
                    dropped: six matchups among four songs settles a podium, but ordering the whole
                    chart is the job, and those same six comparisons do more good spread across the
                    list. Measured over a hundred simulated 60-song rankings, moving them back into
                    the main phase left the whole-chart ordering slightly more accurate, and every
                    quarter of the list level or better.
                </p>
            </section>

            <section className="mb-8">
                <h2 className="mb-2 text-lg font-semibold">Where the audio comes from</h2>
                <p className="mb-3 text-sm leading-relaxed text-fg-muted">
                    Clips come from the <strong className="text-fg">iTunes Search API</strong>,
                    which is free and public and returns a 30-second preview for most tracks.
                    SongRank plays the whole preview — there is no more audio to be had, so
                    there is nothing to gain by playing less of it. A progress bar and an
                    elapsed/total readout show how far through you are, and you can replay a
                    clip as often as you like before deciding.
                </p>
                <p className="text-sm leading-relaxed text-fg-muted">
                    Playback level is evened out between songs, because mastering loudness
                    varies enormously between eras and a quieter recording otherwise loses
                    votes for reasons that have nothing to do with the song.
                </p>
                <p className="text-sm leading-relaxed text-fg-muted">
                    Some tracks have no preview available. Those songs still appear and are still
                    fully votable — you just have to go from memory.
                </p>
            </section>

            <section className="mb-10">
                <h2 className="mb-2 text-lg font-semibold">Accounts are optional — saving isn&apos;t</h2>
                <p className="mb-3 text-sm leading-relaxed text-fg-muted">
                    Building a list and voting through it works fully without signing in. But saving
                    and resuming a ranking is a signed-in feature: without an account, your
                    progress lives only in the current browser tab, and closing or refreshing it
                    loses your place. A Thorough ranking of a large list is thousands of
                    matchups, so that is worth knowing before you start, not after — the build page
                    says so up front if you are not signed in.
                </p>
                <p className="text-sm leading-relaxed text-fg-muted">
                    Signing in with Google adds saved history: a ranking follows you between
                    devices and you can come back to a finished ranking later. See the{" "}
                    <Link href="/privacy" className="text-accent hover:underline">
                        privacy page
                    </Link>{" "}
                    for exactly what gets stored.
                </p>
            </section>

            <Link href="/new" className="btn-primary">
                Start a ranking
            </Link>
        </div>
    );
}
