import Link from "next/link";
import { auth } from "@/auth";
import { hasDatabase } from "@/lib/db";
import { hasGoogleCredentials, isAuthConfigured } from "@/lib/authConfig";
import MyRankings from "@/components/MyRankings";
import DeleteAccountControl from "@/components/DeleteAccountControl";
import UsernameControl from "@/components/UsernameControl";
import { getUsername } from "@/lib/users";
import { listTournaments, listDeletedTournaments, getTopCuts } from "@/lib/queries";
import { looksComplete } from "@/lib/tournamentEngine";
import { suggestUsername } from "@/lib/username";

export const metadata = { title: "My Rankings" };

/**
 * How many rankings get their podium worked out.
 *
 * Deriving one means fetching a ranking's whole song list and vote log and
 * replaying it (see getTopCuts), so this is a bound on how much jsonb a single
 * page view pulls out of the database, not a display limit. Anything past it
 * still lists, still sorts into the right section by estimate, and simply
 * shows no podium -- which is the right thing to degrade to for rankings far
 * enough down the page that nobody scrolled to them.
 */
const PODIUMS_TO_DERIVE = 40;

export default async function MyRankingsPage() {
    // Saved history needs both a database (somewhere to write rows) and
    // Google sign-in (someone to own them) -- see lib/auth-guard.ts's
    // requireUser, which enforces the same pair server-side. Explaining the
    // gap here, rather than letting /api/tournaments 503/401 silently, is
    // what AGENT-TEAM.md means by "make /my-rankings explain what it needs
    // instead of throwing."
    if (!hasDatabase || !isAuthConfigured()) {
        return (
            <div className="mx-auto max-w-lg px-4 py-16 text-center sm:px-6">
                <h1 className="mb-2 text-xl font-bold">Saved rankings aren&apos;t set up yet</h1>
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
                <h1 className="mb-2 text-xl font-bold">Sign in to see your rankings</h1>
                <p className="mb-6 text-sm text-fg-muted">
                    Rankings you save while signed in show up here, resumable from any device.
                </p>
                <Link href="/signin?callbackUrl=/my-rankings" className="btn-primary">
                    Sign in
                </Link>
            </div>
        );
    }

    // The username and delete controls live here because this is the only page
    // that exists *because* you have an account -- putting them anywhere else
    // would mean inventing a settings screen for two controls.
    //
    // The username sits ABOVE the rankings rather than beside the delete
    // button: someone who hasn't picked one is invisible in the directory, and
    // that is worth saying on the way in rather than at the bottom of a page
    // next to the destructive action.
    //
    // The lists are read HERE rather than from the client, because the podiums
    // have to be derived server-side anyway (getTopCuts) -- so the summaries
    // ride along in the same render instead of costing a second round trip and
    // a "Loading..." flash for data this page already has.
    const [username, live, gone] = await Promise.all([
        getUsername(session.user.id),
        listTournaments(session.user.id),
        listDeletedTournaments(session.user.id),
    ]);

    // Only the ones that might be finished are worth deriving: an in-progress
    // ranking has no podium to show, and `looksComplete` answers from counts
    // the summary already carries. Where the estimate is wrong, getTopCuts
    // returns the real status and the list corrects itself.
    const candidates = live.filter(looksComplete).slice(0, PODIUMS_TO_DERIVE);
    const cuts = await getTopCuts(
        session.user.id,
        candidates.map((t) => t.id)
    );
    const details = Object.fromEntries(cuts);

    return (
        <>
            <div className="mx-auto max-w-2xl px-4 pt-6 sm:px-6 sm:pt-8">
                <UsernameControl
                    current={username}
                    suggestion={suggestUsername(session.user.name ?? session.user.email)}
                />
            </div>
            <MyRankings initial={live} initialDeleted={gone} details={details} />
            <div className="mx-auto max-w-3xl px-4 pb-10 sm:px-6">
                <DeleteAccountControl />
            </div>
        </>
    );
}
