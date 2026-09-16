import NewTournament, { type DraftSong, type Prefill } from "@/components/NewTournament";
import { isAuthConfigured } from "@/lib/authConfig";
import { loadStarter } from "@/lib/charts";
import { getPublicTournament } from "@/lib/queries";
import type { Song } from "@/lib/types";

export const metadata = { title: "Create new ranking" };

/**
 * Turns a ready-made list into drafts.
 *
 * `resolved: null` means "look this up on Continue" -- which is right here,
 * because a curated list is title-and-artist text and has never been matched
 * against the catalogue.
 */
function starterDrafts(songs: { title: string; artist: string }[]): DraftSong[] {
    return songs.map((s) => ({
        id: crypto.randomUUID(),
        title: s.title,
        artist: s.artist,
        // Never flagged for review: unlike a pasted line, these were written as
        // a title and an artist, so there is no guess for a human to check.
        ambiguous: false,
        resolved: null,
    }));
}

/**
 * Turns someone's public ranking into drafts.
 *
 * Two things differ from a ready-made list, and both matter:
 *
 *   - **`resolved` is filled in**, so Continue does not re-resolve them. These
 *     songs were already matched against the catalogue once, and the owner may
 *     have used "Change version" to pick a particular recording. Looking them
 *     up again would silently throw that away and could return something else
 *     entirely.
 *   - **The song ids are kept**, which is what lets lib/compare.ts match the
 *     two rankings exactly afterwards -- the whole reason to copy a list rather
 *     than retype it. Ids are only meaningful within one ranking, so sharing
 *     them costs nothing.
 */
function copyDrafts(songs: Song[]): DraftSong[] {
    return songs.map((s) => ({
        id: s.id,
        title: s.title,
        artist: s.artist,
        ambiguous: false,
        resolved: {
            artworkUrl: s.artworkUrl,
            previewUrl: s.previewUrl,
            previewSeconds: s.previewSeconds,
            album: s.album ?? null,
            itunesId: s.itunesId ?? null,
        },
    }));
}

/**
 * `searchParams` is a Promise in this version of Next -- see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md.
 * Awaiting it is what makes this route dynamic, which is correct here: the
 * starter may be the live chart or someone's ranking, and the value varies per
 * request either way.
 */
export default async function NewTournamentPage({
    searchParams,
}: {
    searchParams: Promise<{ starter?: string; copy?: string }>;
}) {
    const { starter: starterId, copy: copyId } = await searchParams;

    // An unknown slug, a chart that couldn't be fetched, or a ranking that is
    // private or deleted all fall through to the ordinary empty build screen
    // rather than an error. Someone who followed a stale link still lands
    // somewhere they can use, which beats a 404 for a parameter that is only
    // ever a convenience. `getPublicTournament` is also the access check: it
    // filters on visibility itself, so there is no way to template a ranking
    // that was never shared.
    let prefill: Prefill | null = null;

    if (copyId) {
        const source = await getPublicTournament(copyId);
        if (source) {
            prefill = {
                name: source.name,
                songs: copyDrafts(source.songs),
                kind: "copy",
                fromName: source.owner_name?.trim() || source.owner_username || null,
                sourceTournamentId: source.id,
            };
        }
    } else if (starterId) {
        const starter = await loadStarter(starterId);
        if (starter) {
            prefill = { name: starter.title, songs: starterDrafts(starter.songs), kind: "starter" };
        }
    }

    return <NewTournament authEnabled={isAuthConfigured()} prefill={prefill} />;
}
