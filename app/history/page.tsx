import Link from "next/link";
import { auth } from "@/auth";
import { hasDatabase } from "@/lib/db";
import { hasGoogleCredentials, isAuthConfigured } from "@/lib/authConfig";
import HistoryList from "@/components/HistoryList";
import DeleteAccountControl from "@/components/DeleteAccountControl";
import UsernameControl from "@/components/UsernameControl";
import { getUsername } from "@/lib/users";
import { suggestUsername } from "@/lib/username";

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
                    Saving rankings needs a database and Google sign-in configured on this
                    deployment, and {!hasDatabase && !hasGoogleCredentials() ? "neither is" : "one isn't"} right
                    now. Every ranking still works fully without it — it&apos;s kept on this device
                    instead of in your account.
                </p>
                <Link href="/new" className="btn-primary">
                    Start a ranking
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

    // The username and delete controls live here because this is the only page
    // that exists *because* you have an account -- putting them anywhere else
    // would mean inventing a settings screen for two controls.
    //
    // The username sits ABOVE the history rather than beside the delete
    // button: someone who hasn't picked one is invisible in the directory, and
    // that is worth saying on the way in rather than at the bottom of a page
    // next to the destructive action.
    const username = await getUsername(session.user.id);

    return (
        <>
            <div className="mx-auto max-w-2xl px-4 pt-6 sm:px-6 sm:pt-8">
                <UsernameControl
                    current={username}
                    suggestion={suggestUsername(session.user.name ?? session.user.email)}
                />
            </div>
            <HistoryList />
            <div className="mx-auto max-w-3xl px-4 pb-10 sm:px-6">
                <DeleteAccountControl />
            </div>
        </>
    );
}
