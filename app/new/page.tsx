import NewTournament from "@/components/NewTournament";
import { isAuthConfigured } from "@/lib/authConfig";

export const metadata = { title: "New tournament" };

export default function NewTournamentPage() {
    return <NewTournament authEnabled={isAuthConfigured()} />;
}
