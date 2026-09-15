import TournamentPlayer from "@/components/TournamentPlayer";
import { isAuthConfigured } from "@/lib/authConfig";

export const metadata = { title: "Playing" };

export default async function TournamentPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return <TournamentPlayer id={id} authEnabled={isAuthConfigured()} />;
}
