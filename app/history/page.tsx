import Link from "next/link";
import { auth } from "@/auth";
import { hasDatabase } from "@/lib/db";
import { hasGoogleCredentials, isAuthConfigured } from "@/lib/authConfig";
import HistoryList from "@/components/HistoryList";

export const metadata = { title: "History" };

export default async function HistoryPage() {
    // Saved history needs both a database (somewhere to write rows) and
    // Google sign-in (someone to own them) -- see lib/auth-guard.ts's
    // requireUser, which enforces the same pair server-side. Explaining the
    // gap here, rather than letting /api/tournaments 503/401 silently, is
    // what AGENT-TEAM.md means by "make /history explain what it needs
    // instead of throwing."
    if (!hasDatabase || !isAuthConfigured()) {
        return (
            <div className="mx-auto max-w-lg px-4 py-16 text-center sm:px-6">
                <h1 className="mb-2 text-xl font-bold">History isn&apos;t set up yet</h1>
                <p className="mb-6 text-sm leading-relaxed text-fg-muted">
                    Saving tournaments needs a database and Google sign-in configured on this
                    deployment, and {!hasDatabase && !hasGoogleCredentials() ? "neither is" : "one isn't"} right
                    now. Every tournament still works fully without it — it&apos;s kept on this device
                    instead of in your account.
                </p>
                <Link href="/new" className="btn-primary">
                    Start a tournament
                </Link>
            </div>
        );
    }

    const session = await auth();
    if (!session?.user) {
        return (
            <div className="mx-auto max-w-lg px-4 py-16 text-center sm:px-6">
                <h1 className="mb-2 text-xl font-bold">Sign in to see your history</h1>
                <p className="mb-6 text-sm text-fg-muted">
                    Tournaments you save while signed in show up here, resumable from any device.
                </p>
                <Link href="/signin?callbackUrl=/history" className="btn-primary">
                    Sign in
                </Link>
            </div>
        );
    }

    return <HistoryList />;
}
