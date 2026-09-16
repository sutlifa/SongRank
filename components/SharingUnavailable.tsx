import Link from "next/link";

/**
 * What the sharing pages show when this deployment has no database or no
 * Google sign-in configured.
 *
 * Same principle as /history's own version (see app/history/page.tsx):
 * explain the gap rather than letting a query throw or rendering an empty
 * page that looks broken. Everything sharing-related genuinely needs both --
 * public rankings belong to accounts, and there are no accounts without a
 * database to keep them in.
 */
export default function SharingUnavailable({ what }: { what: string }) {
    return (
        <div className="mx-auto max-w-lg px-4 py-16 text-center sm:px-6">
            <h1 className="mb-2 text-xl font-bold">{what} isn&apos;t set up yet</h1>
            <p className="mb-6 text-sm leading-relaxed text-fg-muted">
                Sharing rankings needs a database and Google sign-in configured on this deployment.
                Ranking songs still works fully without either — it just stays on your own device.
            </p>
            <Link href="/new" className="btn-primary">
                Start a ranking
            </Link>
        </div>
    );
}
