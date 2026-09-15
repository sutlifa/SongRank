import ResultsView from "@/components/ResultsView";
import { isAuthConfigured } from "@/lib/authConfig";

export const metadata = { title: "Results" };

export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return <ResultsView id={id} authEnabled={isAuthConfigured()} />;
}
