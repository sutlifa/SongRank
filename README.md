# SongRank

Rank any list of songs against each other. Paste a list, search for songs
one by one, or import a Spotify playlist link. Listen to a short clip of
each song, vote on one head-to-head matchup at a time, and get a real,
tiebreak-resolved ranking out the other end — powered by a Swiss-tournament
pairing engine (the same style used in competitive card games), not a bare
sort.

Every core feature works with **zero configuration and no account**: paste
or search for songs, play a full tournament, see the results, and export as
text/CSV/JSON. Each environment variable below unlocks exactly one
additional feature on top of that; nothing is required to run the app.

## Running it

```bash
npm install
npm run dev       # http://localhost:3003
```

```bash
npm run lint       # eslint .
npm run typecheck  # tsc --noEmit
npm run build      # next build
```

The pairing engine (`lib/swiss.ts`) has its own headless check, independent
of the rest of the app:

```bash
npm run db:migrate  # applies lib/db/schema.sql, needs DATABASE_URL
node --experimental-strip-types scripts/verify-swiss.ts
```

`verify-swiss.ts` plays out every field size from 2 to 64 songs under three
voting policies and asserts the engine's invariants on every round (correct
round counts, no duplicate pairings, at most one bye per song, exactly one
champion). See that script's header comment for why it stops at 64 rather
than sweeping much further.

## What each environment variable unlocks

Copy `.env.example` to `.env.local` for local development, or set these in
Vercel under Project Settings → Environment Variables. See `.env.example`
itself for the *why* behind each one — this is just the summary:

| Variable | Unlocks | Missing means |
|---|---|---|
| `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Google sign-in | Sign-in UI is hidden entirely |
| `DATABASE_URL` | Saved history (`/history`), resuming a tournament on another device | `/history` explains it isn't configured; tournaments still work fully, kept in the browser's `localStorage` instead |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | Importing a public Spotify playlist by link | The Spotify tab on `/new` explains it isn't configured and points at paste/search |
| `SPOTIFY_REDIRECT_URI` | Exporting a finished ranking as a new Spotify playlist | The "Export to Spotify" button is visibly disabled with a one-line reason; every other export (copy/CSV/JSON) still works |
| `SONGRANK_PREVIEW_FIXTURES` | **Testing only.** Set to `1` to make song search return a deterministic, offline fixture set with synthesized audio instead of calling the real iTunes API | Leave unset. See `lib/fixtures.ts` |

Saved history specifically needs **both** `DATABASE_URL` and the Google
variables together — an account with nowhere to save a tournament isn't
useful on its own.

## How a tournament works

A tournament is nothing more than its seeded song list plus an ordered vote
log (`lib/types.ts`'s `Tournament`). Every round, pairing, standing and the
eventual champion are *derived* from that log on every render
(`derive()` in `lib/swiss.ts`) rather than stored — which is what makes
undo a one-line operation and a mid-tournament refresh always land back on
the exact matchup you left.

When the song count isn't a power of two, the standard Swiss float-down can
leave the planned rounds with two undefeated songs, or none — the engine
settles this with extra sudden-death "Playoff Round" rounds, clearly labeled
in the UI rather than looking like a bug. See `lib/swiss.ts`'s
`fewestLossesPool` for the full reasoning.

## Where audio comes from

Preview clips come from the free, keyless **iTunes Search API**, not
Spotify — Spotify removed 30-second previews from its Web API for new apps,
so as of 2026 it simply can't supply one. Every request to it goes through
this app's own server routes (`/api/songs/search`, `/api/songs/resolve`),
never directly from the browser, and a missing preview is treated as a
normal, expected outcome (plenty of real tracks don't have one) — the song
stays fully votable either way. See `lib/itunes.ts` for the full reasoning.
