import Link from "next/link";

export const metadata = {
    title: "Privacy",
    description: "What SongRank stores, what it sends to third parties, and what it does not collect.",
};

/**
 * Written against what the code actually does, not against a template.
 *
 * If you change what is stored -- the columns in lib/db/schema.sql, the
 * profile fields auth.ts hands to upsertUser, how lib/spotify.ts keeps its
 * token, or whether @vercel/analytics stays mounted in app/layout.tsx --
 * this page is now wrong and has to change with it. A privacy page that
 * quietly drifts from the code is worse than none, because people rely on it.
 */
export default function PrivacyPage() {
    return (
        <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-14">
            <h1 className="mb-2 text-2xl font-bold sm:text-3xl">Privacy</h1>
            <p className="mb-8 text-sm text-fg-muted">Last updated 15 September 2026</p>

            <p className="mb-8 text-base leading-relaxed text-fg-muted">
                SongRank collects as little as it can get away with. Most of it never leaves your
                browser at all. Here is the whole picture.
            </p>

            <section className="mb-8">
                <h2 className="mb-2 text-lg font-semibold">If you do not sign in</h2>
                <p className="text-sm leading-relaxed text-fg-muted">
                    Nothing about your tournament is stored at all, on our servers or in your
                    browser. Your song list and votes live only in memory for as long as the browser
                    tab stays open — closing or refreshing it loses them, and we never had a copy.
                    Save and resume is a signed-in feature by design (see below), and the build page
                    says so before you start a tournament without one.
                </p>
            </section>

            <section className="mb-8">
                <h2 className="mb-2 text-lg font-semibold">If you sign in with Google</h2>
                <p className="mb-3 text-sm leading-relaxed text-fg-muted">
                    We store, in a Neon Postgres database:
                </p>
                <ul className="mb-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-fg-muted">
                    <li>
                        Your Google account&apos;s <strong className="text-fg">name</strong>,{" "}
                        <strong className="text-fg">email address</strong>,{" "}
                        <strong className="text-fg">avatar image URL</strong> and{" "}
                        <strong className="text-fg">Google account ID</strong>.
                    </li>
                    <li>
                        For each tournament you save: its name, the{" "}
                        <strong className="text-fg">list of songs</strong> and the{" "}
                        <strong className="text-fg">record of which song won each matchup</strong>.
                        Rounds, standings and the final ranking are not stored — they are
                        recalculated from your votes each time.
                    </li>
                </ul>
                <p className="text-sm leading-relaxed text-fg-muted">
                    We do not receive your Google password, and we do not ask Google for access to
                    anything beyond basic profile information. Sessions are held in a signed cookie
                    rather than a database table.
                </p>
            </section>

            <section className="mb-8">
                <h2 className="mb-2 text-lg font-semibold">What gets sent to other companies</h2>
                <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-fg-muted">
                    <li>
                        <strong className="text-fg">Apple (iTunes Search API).</strong> The song
                        titles and artists you search for or paste in are sent to Apple to look up
                        artwork and preview clips. Apple handles that data under its own privacy
                        policy.
                    </li>
                    <li>
                        <strong className="text-fg">Spotify (only if you use it).</strong> If you
                        import a playlist or export a ranking, we talk to Spotify on your behalf.
                        When you connect your Spotify account, the access token is kept in a
                        short-lived, browser-only cookie that JavaScript cannot read. It is never
                        written to our database.
                    </li>
                    <li>
                        <strong className="text-fg">Vercel.</strong> The site is hosted on Vercel
                        and uses Vercel Analytics, which records anonymous page-view data. See{" "}
                        <a
                            href="https://vercel.com/docs/analytics/privacy-policy"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent hover:underline"
                        >
                            Vercel&apos;s analytics privacy documentation
                        </a>
                        .
                    </li>
                </ul>
            </section>

            <section className="mb-8">
                <h2 className="mb-2 text-lg font-semibold">What we do not do</h2>
                <p className="text-sm leading-relaxed text-fg-muted">
                    We do not sell your data, we do not run advertising, and we do not use
                    third-party tracking or advertising cookies. We do not email you — there is no
                    mailing list.
                </p>
            </section>

            <section className="mb-8">
                <h2 className="mb-2 text-lg font-semibold">Deleting your data</h2>
                <p className="text-sm leading-relaxed text-fg-muted">
                    Being straight with you: there is currently no button in the app that deletes
                    your account and its saved tournaments. Until there is, ask via{" "}
                    <a
                        href="https://github.com/sutlifa/SongRank/issues/new"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:underline"
                    >
                        Report a problem
                    </a>{" "}
                    and it will be removed. If you have never signed in, there is nothing to delete
                    — clearing your browser data is enough.
                </p>
            </section>

            <section className="mb-10">
                <h2 className="mb-2 text-lg font-semibold">Questions</h2>
                <p className="text-sm leading-relaxed text-fg-muted">
                    SongRank is open source, so you can check any of this against the code. Raise
                    anything you are unsure about through{" "}
                    <a
                        href="https://github.com/sutlifa/SongRank/issues/new"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:underline"
                    >
                        Report a problem
                    </a>
                    .
                </p>
            </section>

            <Link href="/about" className="text-sm text-accent hover:underline">
                Read about how SongRank works
            </Link>
        </div>
    );
}
