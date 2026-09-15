// lib/localTournaments.ts
//
// Browser-only persistence for a signed-out (or not-yet-synced) tournament.
// Every function here is safe to call from a server render -- `typeof
// window` guards make them all no-ops off the client -- but they're only
// ever meaningfully called from client components, which is why this stays
// separate from lib/queries.ts's server-side, database-backed equivalent.
//
// Every access is wrapped in try/catch: localStorage can throw (Safari
// private browsing, a full quota, a browser extension blocking storage
// access), and none of that should ever be the reason a tournament fails to
// load or a vote fails to register -- it should just mean the vote isn't
// persisted, which is a degraded experience, not a broken one.

import type { Tournament } from "./types";

function key(id: string): string {
    return `songrank:t:${id}`;
}

export function loadLocalTournament(id: string): Tournament | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = window.localStorage.getItem(key(id));
        if (!raw) return null;
        return JSON.parse(raw) as Tournament;
    } catch {
        return null;
    }
}

export function saveLocalTournament(tournament: Tournament): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(key(tournament.id), JSON.stringify(tournament));
    } catch {
        // Quota exceeded or storage blocked -- the in-memory React state is
        // still correct for the rest of this session, it just won't survive
        // a refresh. Nothing useful to surface to the user mid-vote.
    }
}

export function removeLocalTournament(id: string): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.removeItem(key(id));
    } catch {
        // See saveLocalTournament.
    }
}
