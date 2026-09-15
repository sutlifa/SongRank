// lib/sessionCache.ts
//
// An in-memory, per-tab handoff for the tournament currently being played --
// deliberately NOT persistence. This is what lets `/new`'s "Start tournament"
// button redirect straight into a fresh `/t/[id]` mount and have the
// tournament already there, for a signed-out user just as much as a signed-in
// one, without ever touching localStorage or the network for a guest (see
// lib/types.ts's TournamentFormat comment and AGENT-TEAM.md's product
// decision: "save and resume should only work on signed in users").
//
// A plain module-level Map gives exactly the right lifetime for this: it
// survives ordinary client-side navigation within the same page load (so
// undo, voting, and moving between /t/[id] and /t/[id]/results all see the
// same in-progress tournament), and it is gone the moment the tab is closed
// or reloaded -- there is no API to make it durable, which is the point. A
// signed-in user's copy additionally goes to localStorage and the server (see
// components/useTournamentLoader.tsx); a signed-out user's never does.
//
// Safe to import from a server-rendered module: nothing here runs during
// render (see every call site -- always inside a useEffect or an event
// handler, never a useState initializer or render body), so this never
// executes during SSR and can never leak one visitor's in-progress
// tournament into another's response the way a naive server-side singleton
// would.

import type { Tournament } from "./types";

const cache = new Map<string, Tournament>();

export function getSessionTournament(id: string): Tournament | null {
    return cache.get(id) ?? null;
}

export function setSessionTournament(tournament: Tournament): void {
    cache.set(tournament.id, tournament);
}
