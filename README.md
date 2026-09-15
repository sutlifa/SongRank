# SongRank

Turn a list of songs into a ranked list by comparing them two at a time, with a short
audio clip of each to jog your memory. Pairing uses the Swiss tournament system, so every
song keeps playing every round and the whole list ends up ranked — not just the winner.

**Live:** https://song-rankings.vercel.app

## Features

- **Load songs three ways** — paste a list, search for them one by one, or import a public
  Spotify playlist.
- **Tolerant pasting** — handles `Artist - Title`, `Title - Artist`, `Title by Artist`,
  `Title, Artist`, numbered and bulleted lists, quotes and duplicates. Ambiguous rows get
  an editable review step instead of a silent guess.
- **Preview clips** — a 15-second window from each track's 30-second iTunes preview,
  starting a quarter of the way in (the most chorus-likely stretch). Length is adjustable;
  tracks with no preview stay fully votable.
- **Keyboard driven** — `A` / `B` play a clip, `←` / `→` vote. Undo any vote.
- **Survives a refresh** — signed out, the tournament lives in your browser; signed in, it
  follows you between devices.
- **Export** — copy as text, CSV, JSON, or push the ranking straight to a new Spotify
  playlist.

## How the ranking works

A knockout bracket eliminates half the field each round, so most votes tell you nothing
about final placing — a song beaten by the eventual champion in round one ranks no higher
than one beaten by the worst song in the field.

SongRank uses the **Swiss system** (as in Magic: The Gathering tournaments) instead:

- Every song plays every round. A loss does not eliminate you.
- Each round pairs you against a song on a similar record, so contenders meet near the top
  while the rest of the field sorts itself out underneath.
- Rounds are `ceil(log₂(n))` — 16 songs → 4 rounds, 64 songs → 6.
- Rematches are avoided by a backtracking search over each score group. With an odd field,
  the bye goes to the **lowest**-standing song that has not had one, specifically so it
  cannot manufacture extra unbeaten records.
- Final order is wins, then **opponent match-win percentage** (each opponent floored at
  33%, byes excluded), then head-to-head, then seed.

**On exact round counts:** when `n` is a power of two the unbeaten group halves cleanly and
the planned rounds land on exactly one undefeated song every time. Otherwise the odd song
out floats down against someone who already lost, which can leave two unbeaten songs — or
none, if the last perfect record lost on the float. SongRank then runs sudden-death
**playoff rounds** among the leaders until one remains. Simulation puts the overrun at
roughly one extra round for a field like 40 or 100. Load 8, 16, 32 or 64 songs if you want
the round count to be exact.

## Tech

Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind v4 · Auth.js v5
(Google) · Neon Postgres · deployed on Vercel.

## Running locally

```bash
npm install
npm run dev        # http://localhost:3003
```

**It runs with no environment variables set.** Pasting a list, searching, playing a full
tournament, seeing results, and the copy/CSV/JSON exports all work unconfigured. Each
variable below unlocks exactly one extra feature; anything missing degrades to a plain
message in the UI rather than a broken button.

| Variable | What it unlocks |
| --- | --- |
| `DATABASE_URL` | Neon Postgres connection. Use the **pooled** endpoint (host contains `-pooler`) — `lib/db.ts` sets `prepare: false` for it. |
| `AUTH_SECRET` | Session signing. Generate with `npx auth secret`. |
| `AUTH_GOOGLE_ID` | Google OAuth client ID. |
| `AUTH_GOOGLE_SECRET` | Google OAuth client secret. |
| `SPOTIFY_CLIENT_ID` | Spotify playlist **import** (client-credentials flow, no user login). |
| `SPOTIFY_CLIENT_SECRET` | As above. |
| `SPOTIFY_REDIRECT_URI` | Spotify playlist **export**. Must match the dashboard exactly, e.g. `https://song-rankings.vercel.app/api/spotify/callback`. |
| `SONGRANK_PREVIEW_FIXTURES` | Testing only. Set to `1` to serve deterministic fixture songs with locally synthesized preview tones, for environments with no outbound access to `itunes.apple.com`. |

**Google sign-in also requires `DATABASE_URL`.** Signing in writes a user row, so
credentials without a database would authenticate someone into a write with nowhere to go.
Sign-in stays hidden until both halves are present.

Google redirect URI: `https://<your-domain>/api/auth/callback/google`.

## Database

The schema is one idempotent file — every statement is `IF NOT EXISTS` guarded, so it is
safe to re-run. That is the whole migration story; there is no migration tool.

```bash
npm run db:migrate          # applies lib/db/schema.sql
```

Or paste `lib/db/schema.sql` into Neon's SQL editor. Two tables: `users`, and `tournaments`
storing only the song list and the vote log — rounds, standings and the champion are
recomputed from those on every load.

## Checks

```bash
npm run lint
npm run typecheck
npm run build
node --experimental-strip-types scripts/verify-swiss.ts
```

`verify-swiss.ts` plays out tournaments across n = 2..64 under several voting policies and
asserts the invariants that matter: correct round counts, no duplicate pairings within a
round, every song paired at most once per round, at most one bye per song, and exactly one
undefeated champion at the end.

## Licence

No licence specified yet.
