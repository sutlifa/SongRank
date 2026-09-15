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
                    Load songs by pasting a list, searching for them one at a time, or importing a
                    Spotify playlist. Each song is matched against Apple&apos;s music catalogue to
                    pull in artwork and a preview clip.
                </p>
                <p className="text-sm leading-relaxed text-fg-muted">
                    Then you vote. Two songs at a time, with a short clip of each so you can refresh
                    your memory before deciding. One winner per matchup, no ties. When the rounds
                    are done you get a full ranking, not just a winner, and you can export it.
                </p>
            </section>

            <section className="mb-8">
                <h2 className="mb-2 text-lg font-semibold">Why Swiss, not a bracket</h2>
                <p className="mb-3 text-sm leading-relaxed text-fg-muted">
                    A knockout bracket eliminates half the field every round. That finds a winner
                    quickly, but it tells you almost nothing about the rest: a song knocked out in
                    round one by the eventual champion is ranked no higher than one knocked out by
                    the worst song in the field. Most of your votes end up discarded.
                </p>
                <p className="mb-3 text-sm leading-relaxed text-fg-muted">
                    SongRank uses the <strong className="text-fg">Swiss system</strong> instead, the
                    same format Magic: The Gathering tournaments use. Every song plays in every
                    round, and a loss does not eliminate you. Each round you are paired against
                    another song with a similar record, so the strong songs meet each other near the
                    top and the rest of the field sorts itself out underneath. That is what makes
                    the whole list meaningful rather than just the first place.
                </p>
                <p className="text-sm leading-relaxed text-fg-muted">
                    The number of rounds is calculated as ceil(log&#8322;n), so 16 songs take 4
                    rounds and 64 songs take 6. That is the point at which the field can no longer
                    contain more than one unbeaten song.
                </p>
            </section>

            <section className="mb-8">
                <h2 className="mb-2 text-lg font-semibold">Tiebreakers, and why extra rounds happen</h2>
                <p className="mb-3 text-sm leading-relaxed text-fg-muted">
                    When your song count is an exact power of two, the unbeaten group halves
                    cleanly every round and the planned rounds land on exactly one undefeated song.
                    If you want a tournament that finishes precisely when it says it will, load 8,
                    16, 32 or 64 songs.
                </p>
                <p className="mb-3 text-sm leading-relaxed text-fg-muted">
                    Any other count, and the arithmetic stops being tidy. With an odd number in a
                    group, one song floats down to play someone who has already lost. That float can
                    leave two unbeaten songs standing, or none at all if the last perfect record
                    lost on the way down. When that happens SongRank runs extra sudden-death{" "}
                    <strong className="text-fg">playoff rounds</strong> among the leaders until one
                    song is left. Those rounds are labelled as playoffs when they appear, so a
                    tournament that runs slightly long is doing so on purpose.
                </p>
                <p className="text-sm leading-relaxed text-fg-muted">
                    Final placings are decided by wins first, then by{" "}
                    <strong className="text-fg">opponent match-win percentage</strong> — the average
                    strength of everyone you played. Two songs on the same record are separated by
                    who had the harder road, which is fairer than separating them by luck of the
                    draw.
                </p>
            </section>

            <section className="mb-8">
                <h2 className="mb-2 text-lg font-semibold">Where the audio comes from</h2>
                <p className="mb-3 text-sm leading-relaxed text-fg-muted">
                    Clips come from the <strong className="text-fg">iTunes Search API</strong>,
                    which is free and public and returns a 30-second preview for most tracks.
                    SongRank plays a 15-second window starting a quarter of the way in, which is the
                    stretch most likely to land on a chorus. You can change the clip length, replay
                    it, or play the full preview if 15 seconds is not enough.
                </p>
                <p className="text-sm leading-relaxed text-fg-muted">
                    Some tracks have no preview available. Those songs still appear and are still
                    fully votable — you just have to go from memory.
                </p>
            </section>

            <section className="mb-10">
                <h2 className="mb-2 text-lg font-semibold">Accounts are optional</h2>
                <p className="text-sm leading-relaxed text-fg-muted">
                    Every part of SongRank works without signing in. Your tournament is kept in your
                    browser, and it survives a refresh. Signing in with Google adds one thing:
                    saved history, so a tournament follows you between devices and you can come back
                    to a finished ranking later. See the{" "}
                    <Link href="/privacy" className="text-accent hover:underline">
                        privacy page
                    </Link>{" "}
                    for exactly what gets stored.
                </p>
            </section>

            <Link href="/new" className="btn-primary">
                Start a tournament
            </Link>
        </div>
    );
}
