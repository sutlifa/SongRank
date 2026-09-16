import Link from "next/link";

export const metadata = {
    title: "Privacy",
    description: "What SongRank stores, what it sends to third parties, and what it does not collect.",
};

/**
 * Written against what the code actually does, not against a template.
 *
 * If you change what is stored -- the columns in lib/db/schema.sql, the
 * profile fields auth.ts hands to upsertUser, or whether @vercel/analytics
 * stays mounted in app/layout.tsx -- this page is now wrong and has to
 * change with it. A privacy page that quietly drifts from the code is worse
 * than none, because people rely on it.
 */
export default function PrivacyPage() {
    return (
        <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-14">
            <h1 className="mb-2 text-2xl font-bold sm:text-3xl">Privacy</h1>
            <p className="mb-8 text-sm text-fg-muted">Last updated 16 September 2026</p>

            <p className="mb-8 text-base leading-relaxed text-fg-muted">
                SongRank collects as little as it can get away with. Most of it never leaves your
                browser at all. Here is the whole picture.
            </p>

            <section className="mb-8">
                <h2 className="mb-2 text-lg font-semibold">If you do not sign in</h2>
                <p className="text-sm leading-relaxed text-fg-muted">
                    Nothing about your ranking is stored at all, on our servers or in your
                    browser. Your song list and votes live only in memory for as long as the browser
                    tab stays open — closing or refreshing it loses them, and we never had a copy.
                    Save and resume is a signed-in feature by design (see below), and the build page
                    says so before you start a ranking without one.
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
                        <strong className="text-fg">Google account ID</strong>, plus the{" "}
                        <strong className="text-fg">username</strong> you choose, if you choose one.
                        The email address is used to recognise your account, never to contact you and
                        never to show to anyone else.
                    </li>
                    <li>
                        For each ranking you save: its name, the{" "}
                        <strong className="text-fg">list of songs</strong>, the{" "}
                        <strong className="text-fg">record of which song won each matchup</strong>,
                        and whether you have made it public. Rounds, standings and the final ranking
                        are not stored — they are recalculated from your votes each time.
                    </li>
                    <li>
                        Anyone you choose to follow, so your Browse page can put their public
                        rankings first.
                    </li>
                </ul>
                <p className="text-sm leading-relaxed text-fg-muted">
                    We do not receive your Google password, and we do not ask Google for access to
                    anything beyond basic profile information. Sessions are held in a signed cookie
                    rather than a database table.
                </p>
            </section>

            <section className="mb-8">
                <h2 className="mb-2 text-lg font-semibold">What other people can see</h2>
                <p className="mb-3 text-sm leading-relaxed text-fg-muted">
                    <strong className="text-fg">Every ranking you save is private by default</strong>,
                    including every ranking saved before sharing existed. A ranking only becomes
                    visible to anyone else when you choose &ldquo;Make public&rdquo; yourself, and you
                    can take it private again at any time. Nothing you do anywhere else on the site
                    publishes a ranking as a side effect.
                </p>
                <p className="mb-3 text-sm leading-relaxed text-fg-muted">
                    When a ranking is public, anyone — including people who are not signed in — can
                    see its name, its song list, how it came out, and your display name. They can
                    copy the song list to rank themselves, and compare their result with yours. They
                    cannot change your ranking in any way.
                </p>
                <p className="mb-3 text-sm leading-relaxed text-fg-muted">
                    You also appear in the{" "}
                    <Link href="/people" className="text-accent hover:underline">
                        people directory
                    </Link>{" "}
                    once you have published at least one ranking, showing your display name and your
                    username if you have chosen one. People find you by searching either.{" "}
                    <strong className="text-fg">Your email address is never shown to anyone, in any
                    form, and never leaves our server.</strong>{" "}
                    Someone who already knows your address in full can use it to find you — that is
                    there so a friend who has your email can find you before you have picked a
                    username — but a partial address deliberately matches nothing, so the directory
                    cannot be used to discover addresses that aren&apos;t already known.
                </p>
                <p className="mb-3 text-sm leading-relaxed text-fg-muted">
                    Following someone is one-way: it only decides whose public rankings appear first
                    on your Browse page, and it gives neither of you access to anything the other
                    has not made public. Who you follow, and who follows you, are both shown on your
                    profile — so following someone is a public act, even though it grants nothing.
                </p>
                <p className="text-sm leading-relaxed text-fg-muted">
                    Two things put a notice on your{" "}
                    <Link href="/notifications" className="text-accent hover:underline">
                        notifications
                    </Link>{" "}
                    page: someone following you, and someone using one of your public lists to start
                    their own ranking. Both are already visible on your profile, so this only saves
                    you looking. Each is announced at most once per person, and{" "}
                    <strong className="text-fg">we never email you</strong> — there is no mailing
                    list and no way to be sent anything.
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
                <p className="mb-3 text-sm leading-relaxed text-fg-muted">
                    Deleting a single ranking moves it to{" "}
                    <strong className="text-fg">Recently deleted</strong> on your history page. It
                    disappears from Browse, from your profile and from anyone&apos;s comparisons
                    straight away, but we keep the row so you can restore it — a ranking can be
                    hundreds or thousands of decisions, and one misclick should not be able to end
                    that. &ldquo;Delete forever&rdquo;, in that same list, is the irreversible one,
                    and asks you to confirm.
                </p>
                <p className="text-sm leading-relaxed text-fg-muted">
                    To remove everything, go to{" "}
                    <Link href="/history" className="text-accent hover:underline">
                        History
                    </Link>{" "}
                    and choose <strong className="text-fg">Delete my account</strong>. That removes
                    your account row, every ranking you have saved (public ones included, which
                    disappear from Browse immediately) and everyone you follow, in one go and for
                    good, including anything sitting in Recently deleted — we keep no backup copy to restore
                    from, so please be sure. If someone has
                    copied a public list of yours, their own ranking is their own and stays with
                    them; it carries none of your votes. If you have never signed
                    in, there is nothing to delete: clearing your browser data is enough.
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
