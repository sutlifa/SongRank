import type { Song, Standing } from "@/lib/types";
import { recordLabel } from "@/lib/swiss";
import SongArt from "./SongArt";

/** A short "how's it going" strip shown during play — the full table lives on the results page. */
export default function StandingsPeek({ standings, songs, limit = 5 }: { standings: Standing[]; songs: Song[]; limit?: number }) {
    const songById = new Map(songs.map((s) => [s.id, s]));
    const top = standings.slice(0, limit);

    if (top.length === 0) return null;

    return (
        <div className="card p-4">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                Standings so far
            </h2>
            <ol className="space-y-2">
                {top.map((s) => {
                    const song = songById.get(s.songId);
                    if (!song) return null;
                    return (
                        <li key={s.songId} className="flex items-center gap-2 text-sm">
                            <span className="w-4 shrink-0 text-right text-xs text-fg-muted">{s.rank}</span>
                            <SongArt title={song.title} artworkUrl={song.artworkUrl} size={28} />
                            <span className="min-w-0 flex-1 truncate">{song.title}</span>
                            <span className="shrink-0 font-mono text-xs text-fg-muted">{recordLabel(s)}</span>
                        </li>
                    );
                })}
            </ol>
        </div>
    );
}
