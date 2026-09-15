import Link from "next/link";

const REPO_URL = "https://github.com/sutlifa/SongRank";

/**
 * Site-wide footer. Deliberately a server component: it holds no state and
 * reads no session, so keeping it off the client bundle costs nothing and
 * lets every page that uses it stay statically prerendered.
 *
 * The year is hardcoded rather than derived from `new Date().getFullYear()`.
 * That looks lazy and isn't: this footer renders inside the root layout,
 * which is static, so a server-computed year is baked at build time while a
 * client-computed one is read at view time. Across a New Year boundary those
 * two disagree and React reports a hydration mismatch on every page of the
 * site -- a real console error traded for a cosmetic digit. Bump it by hand.
 */
const COPYRIGHT_YEAR = 2026;

export default function SiteFooter() {
    return (
        <footer className="mt-16 border-t border-border bg-bg-soft">
            <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                        <Link href="/about" className="text-fg-muted transition-colors hover:text-fg">
                            About
                        </Link>
                        <Link href="/privacy" className="text-fg-muted transition-colors hover:text-fg">
                            Privacy
                        </Link>
                        <a
                            href={`${REPO_URL}/issues/new`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-fg-muted transition-colors hover:text-fg"
                        >
                            Report a problem
                        </a>
                        <a
                            href={REPO_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-fg-muted transition-colors hover:text-fg"
                        >
                            GitHub
                        </a>
                    </nav>

                    <p className="text-sm text-fg-muted">&copy; {COPYRIGHT_YEAR} SongRank</p>
                </div>

                <p className="mt-4 text-xs leading-relaxed text-fg-muted">
                    Song previews and artwork come from the iTunes Search API. SongRank is not
                    affiliated with Apple.
                </p>
            </div>
        </footer>
    );
}
