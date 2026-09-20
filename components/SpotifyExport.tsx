"use client";

import { useEffect, useRef, useState } from "react";

/**
 * "Send to Spotify", on a finished ranking.
 *
 * Two steps, always, and the split is the whole design. Step one asks what
 * each song WOULD become and writes nothing; step two writes only what the
 * person accepted. The old Spotify *import* was removed rather than fixed
 * because a plausible-looking wrong recording arrives silently and nothing
 * ever tells its owner -- this is that failure made impossible on the way out.
 *
 * Renders nothing at all when the deployment has no Spotify credentials, the
 * same way sign-in hides itself without Google ones: an unconfigured feature
 * should look like a version of the site that never grew it, not a button that
 * leads to an error.
 */

interface SpotifyTrack {
    uri: string;
    title: string;
    artist: string;
    album: string | null;
}

interface Match {
    rank: number;
    title: string;
    artist: string;
    match: SpotifyTrack | null;
    confidence: "high" | "partial" | "none";
    versionWarning: boolean;
}

/** How many rate-limit pauses one match walk will sit out before giving up.
 * A development-mode quota will throttle a long ranking repeatedly -- that is
 * normal, not a fault -- and slices are small, so a 200-song export can
 * legitimately need a couple of dozen pauses. High enough to let that finish;
 * bounded so a genuinely stuck app stops rather than looping until the tab is
 * closed. */
const MAX_RATE_LIMIT_WAITS = 40;

interface Review {
    name: string;
    songCount: number;
    matchupCount: number;
    matches: Match[];
}

export default function SpotifyExport({ tournamentId }: { tournamentId: string }) {
    const [status, setStatus] = useState<{ configured: boolean; connected: boolean } | null>(null);
    const [review, setReview] = useState<Review | null>(null);
    /**
     * Everything matched so far, kept ACROSS attempts.
     *
     * A development-mode Spotify quota throttles a long ranking to a trickle
     * and can keep doing it. Ninety-five songs of a two-hundred-song ranking
     * were being matched and then thrown away when the walk gave up, so the
     * only options were "wait indefinitely" or "lose it all". Progress now
     * survives: the walk resumes from where it stopped, and whatever has been
     * found can be turned into a playlist at any point.
     */
    const [collected, setCollected] = useState<Match[]>([]);
    /** Ranking-wide totals, learned from the first slice that came back. */
    const [header, setHeader] = useState<{ name: string; songCount: number; matchupCount: number; total: number } | null>(null);
    /** Set when the walk stopped early, so the UI can offer to carry on. */
    const [stoppedEarly, setStoppedEarly] = useState(false);
    /** Lets a person bail out of the waiting without losing what was found. */
    const stopRef = useRef(false);
    /** Which ranks the person has chosen to include. Seeded from the match
     * confidence -- see the effect below. */
    const [accepted, setAccepted] = useState<Set<number>>(new Set());
    const [busy, setBusy] = useState<"matching" | "creating" | null>(null);
    /** How far through the ranking the match walk has got. */
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    /** Seconds left on a rate-limit pause, or null when not waiting. */
    const [waiting, setWaiting] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<{ url: string; added: number; requested: number; complete: boolean } | null>(null);

    useEffect(() => {
        fetch("/api/spotify/status")
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => setStatus(d ?? { configured: false, connected: false }))
            .catch(() => setStatus({ configured: false, connected: false }));
    }, []);

    /**
     * Walks the ranking a slice at a time.
     *
     * Not one request, deliberately. Matching a whole ranking in a single call
     * is what made this fail on a real one: enough sequential lookups to
     * outlive the serverless function's duration limit, surfacing as "Spotify
     * didn't answer" because an aborted fetch and a quiet upstream look
     * identical from inside. Slices also mean there is honest progress to show
     * instead of a button that sits there for a minute.
     */
    async function runMatch(resume = false) {
        setBusy("matching");
        setError(null);
        setStoppedEarly(false);
        stopRef.current = false;

        // Resuming continues from what is already matched; starting over
        // clears it. Either way `found` is the single source of truth, so a
        // stop at any point leaves usable results behind.
        const found: Match[] = resume ? [...collected] : [];
        if (!resume) setCollected([]);
        let waits = 0;

        try {
            for (;;) {
                if (stopRef.current) {
                    setStoppedEarly(true);
                    break;
                }
                const res = await fetch("/api/spotify/match", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ tournamentId, offset: found.length }),
                });
                const data = await res.json();

                // A rate limit is a scheduling instruction, not a failure:
                // wait exactly as long as asked and resume the same slice.
                if (res.status === 503 && data.reason === "HTTP 429") {
                    if (waits >= MAX_RATE_LIMIT_WAITS) {
                        setStoppedEarly(true);
                        setError(
                            "Spotify is still rate-limiting this app. Everything found so far is kept — you can make a playlist from it now, or carry on checking."
                        );
                        break;
                    }
                    waits += 1;
                    const seconds = Math.min(Math.max(Number(data.retryAfter) || 5, 1), 60);
                    setError(null);
                    for (let left = seconds; left > 0 && !stopRef.current; left--) {
                        setWaiting(left);
                        await new Promise((r) => setTimeout(r, 1000));
                    }
                    setWaiting(null);
                    continue;
                }

                if (!res.ok) {
                    setStoppedEarly(found.length > 0);
                    setError(
                        data.reason ? `${data.error} (${data.reason})` : (data.error ?? "Could not check your songs against Spotify")
                    );
                    if (data.reason === "not_connected" || data.reason === "reconnect") {
                        setStatus({ configured: true, connected: false });
                    }
                    break;
                }

                setHeader({
                    name: data.name,
                    songCount: data.songCount,
                    matchupCount: data.matchupCount,
                    total: data.total,
                });
                found.push(...(data.matches as Match[]));
                setCollected([...found]);
                setProgress({ done: found.length, total: data.total });
                if (data.done) break;
            }
        } catch {
            setStoppedEarly(found.length > 0);
            setError("Could not reach SongRank. Check your connection and try again.");
        } finally {
            setBusy(null);
            setWaiting(null);
        }

        // Show the review for whatever was found, complete or not. Partial
        // results are the point: 95 of 200 songs is a playlist, and throwing
        // it away because the other 105 are behind a quota helps nobody.
        if (found.length > 0) {
            setReview({ name: header?.name ?? "", songCount: 0, matchupCount: 0, matches: found });
            setAccepted(
                new Set(
                    found
                        .filter((m) => m.match && m.confidence === "high" && !m.versionWarning)
                        .map((m) => m.rank)
                )
            );
        }
    }

    async function create() {
        if (!review) return;
        setBusy("creating");
        setError(null);
        try {
            const uris = review.matches
                .filter((m) => m.match && accepted.has(m.rank))
                .map((m) => m.match!.uri);
            const res = await fetch("/api/spotify/playlist", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tournamentId, uris }),
            });
            const data = await res.json();
            if (!res.ok) {
                setError(data.error ?? "Could not create the playlist");
                return;
            }
            setResult(data);
        } catch {
            setError("Could not reach SongRank. Check your connection and try again.");
        } finally {
            setBusy(null);
        }
    }

    function toggle(rank: number) {
        setAccepted((prev) => {
            const next = new Set(prev);
            if (next.has(rank)) next.delete(rank);
            else next.add(rank);
            return next;
        });
    }

    // Not configured on this deployment: show nothing rather than a dead end.
    if (!status?.configured) return null;

    if (result) {
        return (
            <div className="card p-4">
                <h3 className="mb-1 font-semibold">Playlist created</h3>
                <p className="mb-3 text-sm text-fg-muted">
                    {result.complete
                        ? `All ${result.added} songs added, in ranking order.`
                        : `${result.added} of ${result.requested} songs added — Spotify stopped partway, so the playlist exists but is short. Running the export again creates a second playlist rather than filling this one.`}
                </p>
                <a href={result.url} target="_blank" rel="noopener noreferrer" className="btn-primary">
                    Open in Spotify
                </a>
            </div>
        );
    }

    if (!status.connected) {
        return (
            <div className="card p-4">
                <h3 className="mb-1 font-semibold">Send to Spotify</h3>
                <p className="mb-3 text-sm text-fg-muted">
                    Turn this ranking into a Spotify playlist, in order. SongRank asks only for permission to
                    create playlists — it never reads your library or listening history.
                </p>
                {error && <p className="mb-3 text-sm text-danger">{error}</p>}
                <a href="/api/spotify/authorize" className="btn-secondary">
                    Connect Spotify
                </a>
            </div>
        );
    }

    if (!review) {
        return (
            <div className="card p-4">
                <h3 className="mb-1 font-semibold">Send to Spotify</h3>
                <p className="mb-3 text-sm text-fg-muted">
                    You&apos;ll see what each song matched before anything is created.
                </p>
                {error && <p className="mb-3 text-sm text-danger">{error}</p>}
                <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => runMatch(false)} disabled={busy !== null} className="btn-secondary">
                        {busy === "matching"
                            ? waiting !== null
                                ? `Spotify is busy — resuming in ${waiting}s`
                                : progress
                                  ? `Checking songs… ${progress.done} of ${progress.total}`
                                  : "Checking songs…"
                            : "Check songs on Spotify"}
                    </button>
                    {/* Waiting must never be a trap. Stopping keeps every
                        song matched so far and goes straight to the review,
                        so a throttled export is a shorter playlist rather
                        than a wasted twenty minutes. */}
                    {busy === "matching" && (
                        <button
                            type="button"
                            onClick={() => {
                                stopRef.current = true;
                            }}
                            className="btn-ghost"
                        >
                            Stop and use what&apos;s found
                        </button>
                    )}
                </div>
                {busy === "matching" && progress && (
                    <p className="mt-2 text-xs text-fg-muted">
                        Spotify limits how fast an app can search, so a long ranking takes a while. Everything
                        found so far is kept if you stop.
                    </p>
                )}
            </div>
        );
    }

    const missing = review.matches.filter((m) => !m.match).length;
    const chosen = review.matches.filter((m) => m.match && accepted.has(m.rank)).length;

    return (
        <div className="card p-4">
            <h3 className="mb-1 font-semibold">Send to Spotify</h3>
            <p className="mb-3 text-sm text-fg-muted">
                {chosen} of {review.matches.length} songs selected
                {missing > 0 ? `, ${missing} not found on Spotify` : ""}. Nothing is created until you press the
                button.
            </p>
            {/* Said plainly, because a playlist that silently stops at song 95
                of 200 is worse than a short one you chose. */}
            {stoppedEarly && header && review.matches.length < header.total && (
                <p className="mb-3 rounded-lg border border-border bg-bg-soft-2/60 px-3 py-2 text-xs text-fg-muted">
                    Checked the top <strong className="text-fg">{review.matches.length}</strong> of{" "}
                    {header.total} songs before Spotify&apos;s rate limit stopped play. You can make a playlist
                    from these now — it will be the top {review.matches.length} of your ranking, in order — or
                    carry on checking the rest.{" "}
                    <button
                        type="button"
                        onClick={() => runMatch(true)}
                        disabled={busy !== null}
                        className="underline underline-offset-2 hover:text-fg"
                    >
                        Carry on from {review.matches.length + 1}
                    </button>
                </p>
            )}
            {error && <p className="mb-3 text-sm text-danger">{error}</p>}

            <ul className="mb-4 max-h-96 space-y-1 overflow-y-auto">
                {review.matches.map((m) => (
                    <li key={m.rank} className="flex items-start gap-2 border-b border-border py-1.5 text-xs last:border-0">
                        <span className="w-6 shrink-0 text-right font-mono text-fg-muted">{m.rank}</span>
                        {m.match ? (
                            <input
                                type="checkbox"
                                checked={accepted.has(m.rank)}
                                onChange={() => toggle(m.rank)}
                                className="mt-0.5 shrink-0"
                                aria-label={`Include ${m.title}`}
                            />
                        ) : (
                            <span className="mt-0.5 w-3 shrink-0" aria-hidden="true" />
                        )}
                        <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium text-fg">{m.title}</span>
                            <span className="block truncate text-fg-muted">{m.artist || "Unknown artist"}</span>
                            {m.match ? (
                                // What it will ACTUALLY add, shown whenever it
                                // differs from what was asked for. A match that
                                // reads identically needs no second line; one
                                // that doesn't is the whole reason this screen
                                // exists.
                                (m.match.title !== m.title || m.match.artist !== m.artist) && (
                                    <span className="mt-0.5 block truncate text-accent">
                                        → {m.match.title} · {m.match.artist}
                                    </span>
                                )
                            ) : (
                                <span className="mt-0.5 block text-fg-muted">Not found on Spotify</span>
                            )}
                            {m.versionWarning && (
                                <span className="mt-0.5 block text-danger">
                                    Different version — check this one
                                </span>
                            )}
                            {m.match && m.confidence === "partial" && !m.versionWarning && (
                                <span className="mt-0.5 block text-fg-muted">Not an exact match</span>
                            )}
                        </span>
                    </li>
                ))}
            </ul>

            <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={create} disabled={busy !== null || chosen === 0} className="btn-primary">
                    {busy === "creating" ? "Creating…" : `Create playlist (${chosen})`}
                </button>
                <button type="button" onClick={() => setReview(null)} disabled={busy !== null} className="btn-ghost">
                    Cancel
                </button>
            </div>
        </div>
    );
}
