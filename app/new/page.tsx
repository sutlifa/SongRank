import NewTournament from "@/components/NewTournament";
import { isSpotifyConfigured } from "@/lib/spotify";

export const metadata = { title: "New tournament" };

export default function NewTournamentPage() {
    return <NewTournament spotifyImportEnabled={isSpotifyConfigured()} />;
}
