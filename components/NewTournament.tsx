"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MAX_SONGS } from "@/lib/swiss";
import { describeRankingPlan, estimateMatchups, ROUND_ROBIN_CEILING } from "@/lib/ranking";
import { RANKING_DEPTHS, type ClipSeconds, type RankingDepth, type Song, type Tournament } from "@/lib/types";
import type { MatchConfidence } from "@/lib/parse";
import { saveLocalTournament } from "@/lib/localTournaments";
import { setSessionTournament } from "@/lib/sessionCache";
import SessionStatus from "./SessionStatus";
import PasteImportTab from "./PasteImportTab";
import SearchImportTab from "./SearchImportTab";
import ReviewTable from "./ReviewTable";
import PreflightCheck from "./PreflightCheck";

const DEPTH_LABELS: Record<RankingDepth, string> = { quick: "Quick", balanced: "Balanced", thorough: "Thorough" };
const DEPTH_HINTS: Record<RankingDepth, string> = {
    quick: "Fastest ranking, least precise on close calls.",
    balanced: "A middle ground between speed and precision.",
    thorough: "Most reliable ranking. Recommended — this is the default for a reason.",
};

/**
 * The "save and resume needs an account" warning, shown before a signed-out
 * (or auth-unconfigured) visitor commits to a ranking -- product decision,
 * see AGENT-TEAM.md and CLAUDE.md's Ranking engine section: "save and resume
 * should only work on signed in users." Thorough on a large list is
 * thousands of matchups, so losing that progress on a refresh is a real cost,
 * not a footnote -- this has to be prominent, not buried, which is the whole
 * reason the restriction is acceptable at all.
 */
function GuestSaveWarning({ authEnabled }: { authEnabled: boolean }) {
    return (
        <div className="rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-fg">
            <p className="font-semibold text-accent">Your progress won&apos;t be saved.</p>
            <p className="mt-1 text-fg-muted">
                {authEnabled
                    ? "You're not signed in, so this ranking lives only in this browser tab — closing or refreshing it loses your place, however many matchups in you are."
                    : "This deployment doesn't have sign-in set up, so no ranking can be saved here — it lives only in this browser tab until you close it."}
            </p>
            {authEnabled && (
                <Link href="/signin?callbackUrl=/new" className="btn-secondary mt-2 inline-block !px-3 !py-1.5 text-xs">
                    Sign in to save your progress
                </Link>
            )}
        </div>
    );
}

/**
 * A song mid-import, before it's a real `Song`. Both import tabs
 * (paste/search) produce these; the review table lets a human
 * edit them; `proceedToPreflight` below turns the finished list into
 * `Song[]` and hands off to the pre-flight check.
 *
 * `resolved` is `null` for anything that still needs an iTunes lookup
 * (a pasted song, or a paste-imported song the catalogue
 * lookup in PasteImportTab couldn't confidently match) and already-filled
 * for anything that came with artwork/preview already attached (a search
 * result, or a high-confidence paste match). Keeping this distinction is
 * what lets `proceedToPreflight` skip re-resolving songs that don't need it.
 */
export interface DraftSong {
    id: string;
    title: string;
    artist: string;
    ambiguous: boolean;
    /**
     * `confidence` is optional because only NewTournament's own
     * `resolvePreviews` pass (the iTunes cascade in lib/itunes.ts) ever
     * scores one -- PasteImportTab already filters to "high" before setting
     * `resolved`, and SearchImportTab's entries are a human's own pick, so
     * neither needs a score attached to be trusted. Only "partial" is ever
     * surfaced anywhere (a "none" never reaches here -- resolveSong returns
     * null for those, and this whole field stays null); see PreflightCheck's
     * `weakSongIds` prop for what that drives.
     */
    resolved: {
        artworkUrl: string | null;
        previewUrl: string | null;
        previewSeconds: number | null;
        confidence?: MatchConfidence;
    } | null;
}

type Tab = "paste" | "search";

/** The two steps of /new: build the list, then the pre-flight check (problem 2) before a ranking can start. */
type Step = "build" | "preflight";

/** Turns a resolved draft into the real, savable `Song` shape. Pulled out of `proceedToPreflight` so it's one place, not a copy living in both the "just resolved" path and any future re-derivation. */
function draftToSong(d: DraftSong): Song {
    return {
        id: d.id,
        title: d.title.trim(),
        artist: d.artist.trim(),
        // Neither import tab (paste or search) threads an iTunes album/id
        // through `DraftSong.resolved` today -- both fields are optional on
        // `Song` for exactly this reason (see lib/types.ts). A later
        // "Change version" swap (lib/songVersion.ts) fills them in properly.
        album: null,
        artworkUrl: d.resolved?.artworkUrl ?? null,
        previewUrl: d.resolved?.previewUrl ?? null,
        previewSeconds: d.resolved?.previewSeconds ?? null,
        previewNote: d.resolved?.previewUrl ? null : "No preview available for this track.",
        itunesId: null,
    };
}

/** Resolves a batch of draft songs against iTunes with bounded concurrency. */
async function resolvePreviews(
    drafts: DraftSong[],
    onProgress: (done: number, total: number) => void
): Promise<DraftSong[]> {
    const toResolve = drafts.filter((d) => d.resolved === null);
    if (toResolve.length === 0) return drafts;

    const resolvedById = new Map<string, DraftSong["resolved"]>();
    let done = 0;
    const CONCURRENCY = 6;
    let cursor = 0;

    async function worker() {
        for (;;) {
            const index = cursor++;
            if (index >= toResolve.length) return;
            const draft = toResolve[index];
            try {
                const res = await fetch("/api/songs/resolve", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ title: draft.title, artist: draft.artist }),
                });
                const data = await res.json();
                resolvedById.set(
                    draft.id,
                    data.preview
                        ? {
                              artworkUrl: data.preview.artworkUrl ?? null,
                              previewUrl: data.preview.previewUrl ?? null,
                              previewSeconds: data.preview.previewSeconds ?? null,
                              confidence: (data.confidence as MatchConfidence | undefined) ?? "none",
                          }
                        : null
                );
            } catch {
                resolvedById.set(draft.id, null);
            }
            done += 1;
            onProgress(done, toResolve.length);
        }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, toResolve.length) }, worker));

    return drafts.map((d) => (resolvedById.has(d.id) ? { ...d, resolved: resolvedById.get(d.id)! } : d));
}

export default function NewTournament({
    authEnabled,
}: {
    authEnabled: boolean;
}) {
    const router = useRouter();
    const [tab, setTab] = useState<Tab>("paste");
    const [songs, setSongs] = useState<DraftSong[]>([]);
    const [name, setName] = useState("");
    // Always the full preview. Apple's previews are 30 seconds and that is the
    // most audio we are ever given, so there is no upside to offering less --
    // the old 10/15/30 choice only let someone make their own comparisons
    // harder. Kept as a value (rather than deleted) because saved rankings
    // already carry a clipSeconds and the field still round-trips.
    const clipSeconds: ClipSeconds = 30;
    /** Thorough is the default -- the user's own choice, see CLAUDE.md's
     * Ranking engine section -- and only matters once the field is big enough
     * that the engine isn't already doing a full round robin regardless
     * (n <= ROUND_ROBIN_CEILING plays every pair once no matter what). */
    const [depth, setDepth] = useState<RankingDepth>("thorough");
    const [starting, setStarting] = useState<{ done: number; total: number } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [step, setStep] = useState<Step>("build");
    const [preflightSongs, setPreflightSongs] = useState<Song[]>([]);
    /**
     * Ids of songs whose iTunes match came back "partial" rather than
     * "high" -- see DraftSong.resolved's own doc comment. These songs *do*
     * have a previewUrl (draftToSong still fills it in), so they wouldn't
     * otherwise trip PreflightCheck's "missing preview" check, but problem B
     * asks for auto-suggestions on "no preview *or* no confident match" --
     * this set is how the pre-flight screen tells the two apart from a
     * preview URL alone.
     */
    const [weakSongIds, setWeakSongIds] = useState<Set<string>>(new Set());
    /** True only for the brief window between the pre-flight "Start ranking" click and the redirect -- there's no network wait here (saving is local-first), but a double-click shouldn't queue two saves. */
    const [launching, setLaunching] = useState(false);
    /** Whether *this visitor* is actually signed in -- not the same as
     * `authEnabled`, which only says the deployment supports it. Determined
     * by SessionStatus (see that component's header for why this component
     * can't call `useSession()` itself) and used both to decide whether to
     * persist the tournament at all (see confirmStart) and to show the
     * "your progress won't be saved" warning below. Starts false so a
     * guest's tournament is never optimistically saved before we actually
     * know -- see loading's own gate in GuestSaveWarning's caller. */
    const [signedIn, setSignedIn] = useState(false);
    const [authLoading, setAuthLoading] = useState(authEnabled);
    const sessionStatus = authEnabled ? (
        <SessionStatus
            onChange={(nextSignedIn, loading) => {
                setSignedIn(nextSignedIn);
                setAuthLoading(loading);
            }}
        />
    ) : null;

    function addSongs(incoming: DraftSong[]) {
        setSongs((prev) => {
            const seen = new Set(prev.map((s) => `${s.title.toLowerCase()}|${s.artist.toLowerCase()}`));
            const room = MAX_SONGS - prev.length;
            const accepted: DraftSong[] = [];
            for (const song of incoming) {
                if (accepted.length >= room) break;
                const key = `${song.title.toLowerCase()}|${song.artist.toLowerCase()}`;
                if (seen.has(key)) continue;
                seen.add(key);
                accepted.push(song);
            }
            return [...prev, ...accepted];
        });
    }

    function updateSong(id: string, patch: Partial<Pick<DraftSong, "title" | "artist">>) {
        setSongs((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch, ambiguous: false } : s)));
    }

    function removeSong(id: string) {
        setSongs((prev) => prev.filter((s) => s.id !== id));
    }

    /**
     * "Continue" on the build step: resolves previews (same network pass as
     * before) and hands off to the pre-flight check -- see PreflightCheck's
     * own header for why that's a second view of this component's state
     * rather than a second route. The tournament itself isn't created here;
     * it's only ever created by `confirmStart`, once the user has actually
     * looked at the pre-flight screen. That's what makes "the tournament
     * must not be startable without passing through it" (problem 2) true by
     * construction rather than by convention.
     */
    async function proceedToPreflight() {
        setError(null);
        const cleanSongs = songs.filter((s) => s.title.trim());
        if (cleanSongs.length < 2) {
            setError("Add at least 2 songs to start a ranking.");
            return;
        }

        setStarting({ done: 0, total: cleanSongs.length });
        const resolved = await resolvePreviews(cleanSongs, (done, total) => setStarting({ done, total }));
        setStarting(null);

        // Cache the resolution back onto the draft list (keyed by the
        // draft's own stable id) so going back to "build" and forward again
        // doesn't re-resolve songs that already have an answer.
        setSongs((prev) => {
            const byId = new Map(resolved.map((d) => [d.id, d]));
            return prev.map((d) => byId.get(d.id) ?? d);
        });

        // Merge, don't replace: a song already customized on the pre-flight
        // screen (replaced via search, or removed) keeps that edit even if
        // the user goes back to add more and returns here. A song that's
        // gone from `resolved` (removed back on the build step) is dropped
        // here too, for the same reason.
        const asSongs = resolved.map(draftToSong);
        setPreflightSongs((prev) => {
            const prevById = new Map(prev.map((s) => [s.id, s]));
            return asSongs.map((s) => prevById.get(s.id) ?? s);
        });

        // A song the pre-flight screen already replaced (via a suggestion or
        // the manual search box) is no longer "weak" -- its replacement came
        // from a human's own pick, same trust level as SearchImportTab. Only
        // songs still carrying a "partial" score from *this* resolve pass
        // stay flagged, so going back to "build" and forward again doesn't
        // resurrect a fix the user already made.
        setWeakSongIds((prev) => {
            const next = new Set(prev);
            for (const d of resolved) {
                if (d.resolved?.confidence === "partial") next.add(d.id);
                else next.delete(d.id);
            }
            return next;
        });

        setStep("preflight");
    }

    /** The pre-flight screen's own "Start ranking" -- this is the only place a Tournament actually gets created. */
    function confirmStart(finalSongs: Song[]) {
        setLaunching(true);
        const trimmedName = name.trim() || "My songs";
        const now = new Date().toISOString();
        const tournament: Tournament = {
            id: crypto.randomUUID(),
            name: trimmedName,
            createdAt: now,
            updatedAt: now,
            clipSeconds,
            format: "adaptive",
            depth,
            songs: finalSongs,
            votes: [],
        };

        // Always: the in-tab handoff to /t/[id] -- see lib/sessionCache.ts's
        // header for why this isn't persistence and is therefore safe for a
        // guest too.
        setSessionTournament(tournament);

        // Only for an actually signed-in visitor: the durable copies. A
        // guest gets neither -- not even a best-effort attempt -- per the
        // product decision described in GuestSaveWarning above; the
        // /api/tournaments route would 401 them anyway (see
        // lib/auth-guard.ts), but skipping the call entirely is what makes
        // "no persistence" true rather than "no persistence, except one
        // wasted request."
        if (signedIn) {
            saveLocalTournament(tournament);
            fetch("/api/tournaments", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    id: tournament.id,
                    name: tournament.name,
                    clipSeconds: tournament.clipSeconds,
                    format: tournament.format,
                    depth: tournament.depth,
                    songs: tournament.songs,
                    votes: tournament.votes,
                }),
            }).catch(() => {});
        }

        router.push(`/t/${tournament.id}`);
    }

    if (step === "preflight") {
        return (
            <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
                {sessionStatus}
                <h1 className="mb-1 text-xl font-bold sm:text-2xl">Check before you start</h1>
                <p className="mb-6 text-sm text-fg-muted">
                    Every song, with its clip if it has one -- confirm the audio is right before committing to a
                    full ranking.
                </p>
                {!authLoading && !signedIn && (
                    <div className="mb-6">
                        <GuestSaveWarning authEnabled={authEnabled} />
                    </div>
                )}
                <PreflightCheck
                    songs={preflightSongs}
                    weakSongIds={weakSongIds}
                    clipSeconds={clipSeconds}
                    onChange={setPreflightSongs}
                    onWeakResolved={(id) =>
                        setWeakSongIds((prev) => {
                            if (!prev.has(id)) return prev;
                            const next = new Set(prev);
                            next.delete(id);
                            return next;
                        })
                    }
                    onBack={() => setStep("build")}
                    onStart={() => confirmStart(preflightSongs)}
                    starting={launching}
                />
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
            {sessionStatus}
            <h1 className="mb-1 text-xl font-bold sm:text-2xl">Build your ranking</h1>
            <p className="mb-6 text-sm text-fg-muted">
                Add songs from any combination of the tabs below, then review and start.
            </p>

            {!authLoading && !signedIn && (
                <div className="mb-6">
                    <GuestSaveWarning authEnabled={authEnabled} />
                </div>
            )}

            <div className="card p-4 sm:p-5">
                <div className="mb-4 flex gap-1 border-b border-border pb-3">
                    {(
                        [
                            ["paste", "Paste a list"],
                            ["search", "Search"],
                        ] as [Tab, string][]
                    ).map(([value, label]) => (
                        <button
                            key={value}
                            type="button"
                            onClick={() => setTab(value)}
                            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                                tab === value ? "bg-bg-soft-2 text-fg" : "text-fg-muted hover:bg-bg-soft-2"
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {tab === "paste" && <PasteImportTab onAdd={addSongs} />}
                {tab === "search" && <SearchImportTab onAdd={addSongs} />}
            </div>

            <div className="mt-6">
                <div className="mb-3 flex items-center justify-between">
                    <h2 className="font-semibold">
                        Review ({songs.length}/{MAX_SONGS})
                    </h2>
                </div>
                <ReviewTable songs={songs} onChange={updateSong} onRemove={removeSong} />
            </div>

            <div className="card mt-6 space-y-4 p-4 sm:p-5">
                <div className="grid gap-4">
                    <label className="block">
                        <span className="mb-1 block text-xs font-medium text-fg-muted">Ranking name</span>
                        <input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="My songs"
                            maxLength={120}
                            className="input"
                        />
                    </label>
                </div>

                {songs.length > ROUND_ROBIN_CEILING ? (
                    <div>
                        <span className="mb-2 block text-xs font-medium text-fg-muted">
                            Ranking depth
                        </span>
                        <div className="grid gap-2 sm:grid-cols-3">
                            {RANKING_DEPTHS.map((d) => (
                                <button
                                    key={d}
                                    type="button"
                                    onClick={() => setDepth(d)}
                                    aria-pressed={depth === d}
                                    className={`rounded-lg border p-3 text-left transition-colors ${
                                        depth === d
                                            ? "border-accent bg-accent/10"
                                            : "border-border hover:bg-bg-soft-2"
                                    }`}
                                >
                                    <span className="block text-sm font-semibold">{DEPTH_LABELS[d]}</span>
                                    <span className="mt-0.5 block text-xs text-fg-muted">
                                        ~{estimateMatchups(songs.length, d).toLocaleString()} matchups
                                    </span>
                                    <span className="mt-1 block text-xs text-fg-muted">{DEPTH_HINTS[d]}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    songs.length >= 2 && (
                        <p className="text-xs text-fg-muted">
                            {songs.length} songs is small enough for a full round robin -- every pair plays once,
                            so ranking depth doesn&apos;t change anything here.
                        </p>
                    )
                )}

                <p className="text-sm text-fg-muted">{describeRankingPlan(songs.length, depth)}</p>

                {error && (
                    <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                        {error}
                    </p>
                )}

                <button
                    type="button"
                    onClick={proceedToPreflight}
                    disabled={Boolean(starting)}
                    className="btn-primary w-full text-base"
                >
                    {starting ? `Finding clips… ${starting.done}/${starting.total}` : "Continue"}
                </button>
            </div>
        </div>
    );
}
