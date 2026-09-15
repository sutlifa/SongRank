"use client";

import type { DraftSong } from "./NewTournament";

/**
 * The editable review step every import path funnels into before a
 * tournament starts. It exists specifically for the rows lib/parse.ts still
 * can't confidently resolve after its heuristic, frequency-analysis and
 * catalogue-lookup passes -- those get a visible swap control instead of a
 * silent guess. See lib/parse.ts's header for the full reasoning. With all
 * three passes in play this should be a short list even for a large pasted
 * batch, not the whole thing.
 */
export default function ReviewTable({
    songs,
    onChange,
    onRemove,
}: {
    songs: DraftSong[];
    onChange: (id: string, patch: Partial<Pick<DraftSong, "title" | "artist">>) => void;
    onRemove: (id: string) => void;
}) {
    if (songs.length === 0) {
        return (
            <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-fg-muted">
                No songs yet — add some above.
            </p>
        );
    }

    return (
        <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-sm">
                <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-fg-muted">
                        <th className="py-2 pr-2 font-medium">Title</th>
                        <th className="py-2 pr-2 font-medium">Artist</th>
                        <th className="py-2 pr-2 font-medium" />
                    </tr>
                </thead>
                <tbody>
                    {songs.map((song) => (
                        <tr key={song.id} className="border-b border-border/60 align-top">
                            <td className="py-2 pr-2">
                                <input
                                    value={song.title}
                                    onChange={(e) => onChange(song.id, { title: e.target.value })}
                                    className="input !py-1.5"
                                    aria-label={`Title for ${song.title || "song"}`}
                                />
                            </td>
                            <td className="py-2 pr-2">
                                <input
                                    value={song.artist}
                                    onChange={(e) => onChange(song.id, { artist: e.target.value })}
                                    className="input !py-1.5"
                                    aria-label={`Artist for ${song.title || "song"}`}
                                />
                                {/* A swappable guess needs both sides filled in -- an ambiguous
                                    row with no artist at all (no separator lib/parse.ts could find,
                                    or no confident catalogue match) wasn't guessed from a two-sided
                                    split, it just has nothing in the artist field yet, and swapping
                                    it would blank the title for nothing to show in its place. */}
                                {song.ambiguous && song.artist.trim() && (
                                    <p className="mt-1 text-[11px] text-accent">
                                        Not confirmed — double check title and artist, or swap →
                                    </p>
                                )}
                            </td>
                            <td className="py-2 pr-0 text-right whitespace-nowrap">
                                {song.ambiguous && song.artist.trim() && (
                                    <button
                                        type="button"
                                        onClick={() => onChange(song.id, { title: song.artist, artist: song.title })}
                                        className="btn-ghost !px-2 !py-1.5 text-xs"
                                        title="Swap title and artist"
                                    >
                                        ⇄ Swap
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => onRemove(song.id)}
                                    className="btn-ghost !px-2 !py-1.5 text-xs text-danger"
                                    aria-label={`Remove ${song.title || "song"}`}
                                >
                                    ✕
                                </button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
