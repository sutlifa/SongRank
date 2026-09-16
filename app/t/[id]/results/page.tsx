import ResultsView from "@/components/ResultsView";
import { isAuthConfigured } from "@/lib/authConfig";
import { hasDatabase } from "@/lib/db";
import { auth } from "@/auth";
import { getVisibility } from "@/lib/queries";

export const metadata = { title: "Results" };

export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    // Looked up here rather than fetched by the client, because the answer is
    // already a server-side question and threading it through
    // useTournamentLoader would mean teaching the whole save/resume pipeline
    // about a field it never writes.
    //
    // Null covers every case where "who can see this" isn't a question that
    // applies: a signed-out visitor, a deployment with no database, or a
    // ranking that lives only in this browser tab and was never saved. The
    // toggle simply isn't rendered for those -- an unsaved ranking cannot be
    // published, and offering the switch would be promising something that
    // can't happen.
    let visibility = null;
    if (hasDatabase && isAuthConfigured()) {
        const session = await auth();
        if (session?.user?.id) visibility = await getVisibility(session.user.id, id);
    }

    return <ResultsView id={id} authEnabled={isAuthConfigured()} visibility={visibility} />;
}
