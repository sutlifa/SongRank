"use client";

import { useEffect, useState } from "react";
import PersonRow from "./PersonRow";
import type { PersonSummary } from "@/lib/people";

/** Below this, a query is too broad to be a search -- see SEARCH_LIMIT's
 * reasoning in lib/people.ts. Matches the server's own floor. */
const MIN_QUERY = 2;

/**
 * Live search over the people directory.
 *
 * Debounced rather than fired per keystroke: a name typed at speed would
 * otherwise be one query against the users table per character, for answers
 * nobody reads.
 *
 * One piece of state, holding the query its results belong to. Everything
 * else -- whether a search is in flight, whether to show anything at all --
 * is derived during render from that plus the input. The alternative (a
 * separate `searching` flag set in the effect body) is what the
 * cascading-renders lint rule is there to prevent, and the derived version is
 * also simply more correct: "the results on screen are for a different query
 * than the one in the box" is exactly what "searching" means, and it cannot
 * drift out of step with reality the way a hand-maintained flag can.
 */
export default function PeopleSearch({ friendIds }: { friendIds: number[] }) {
    const [query, setQuery] = useState("");
    const [answer, setAnswer] = useState<{ query: string; people: PersonSummary[] } | null>(null);
    const friends = new Set(friendIds);

    const trimmed = query.trim();
    const active = trimmed.length >= MIN_QUERY;
    const searching = active && answer?.query !== trimmed;
    const results = active && answer?.query === trimmed ? answer.people : null;

    useEffect(() => {
        const q = query.trim();
        if (q.length < MIN_QUERY) return;

        // `cancelled` rather than an AbortController because the only thing
        // that matters is not applying a stale answer over a newer one: a
        // request for an older query that lands late would otherwise overwrite
        // results for the query the person has already moved on to.
        let cancelled = false;
        const timer = setTimeout(async () => {
            try {
                const res = await fetch(`/api/people?q=${encodeURIComponent(q)}`);
                const data = (await res.json()) as { people?: PersonSummary[] };
                if (!cancelled) setAnswer({ query: q, people: data.people ?? [] });
            } catch {
                if (!cancelled) setAnswer({ query: q, people: [] });
            }
        }, 300);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [query]);

    return (
        <div>
            <label className="block">
                <span className="mb-1 block text-xs font-medium text-fg-muted">
                    Search by username or name
                </span>
                <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="sam, or Sam Smith"
                    className="input"
                    autoComplete="off"
                    type="search"
                />
            </label>

            {active && (
                <div className="mt-4" aria-live="polite">
                    {searching && <p className="text-sm text-fg-muted">Searching…</p>}
                    {results !== null && results.length === 0 && (
                        <p className="text-sm text-fg-muted">
                            Nobody matched that. You can also paste someone&apos;s full email address
                            if you know it — a partial one deliberately doesn&apos;t match, so the
                            directory can&apos;t be used to discover addresses.
                        </p>
                    )}
                    {results !== null && results.length > 0 && (
                        <ul className="space-y-2">
                            {results.map((person) => (
                                <li key={person.id}>
                                    <PersonRow
                                        person={person}
                                        badge={friends.has(person.id) ? "Following" : undefined}
                                    />
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}
