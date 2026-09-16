# SongRank

Turn a list of songs into a ranked list by comparing them two at a time, with a short
audio clip of each to jog your memory. An adaptive pairwise ranking engine picks each
matchup to be the one whose outcome teaches it the most, so the whole list ends up
ranked — not just the winner — using far fewer comparisons than a fixed bracket or
round schedule would need.

**Live:** https://song-rankings.vercel.app

## Features

- **Load songs two ways** — paste a list, or search for them one by one.
- **Tolerant pasting** — handles `Artist - Title`, `Title - Artist`, `Title by Artist`,
  `Title, Artist`, numbered and bulleted lists, quotes and duplicates. Ambiguous rows get
  an editable review step instead of a silent guess.
- **Preview clips** — the full 30-second iTunes preview for each track, with a progress
  bar and an elapsed/total readout. Loudness is evened out across songs so an old quiet
  master doesn't lose to a modern loud one. Tracks with no preview stay fully votable.
- **Keyboard driven** — `A` / `B` play a clip, `←` / `→` vote, `C` flips a coin. Undo any
  vote.
- **No forced picks** — a matchup you can't separate can be answered "flip a coin", which
  records a tie. The ratings apply it as an Elo draw, so neither song is credited with a win
  it didn't earn, and the pair is left out of the head-to-head tiebreak. Ties show in the
  standings as the third number in `4-2-1`.
- **Stop any time** — the ranking is valid after any number of votes. A readout shows the
  fraction of all pairs the engine can already order confidently ("how much of the final
  answer is decided if I stop now"), and a small or lopsided list can finish before its
  estimated matchup count.
- **Save and resume — signed-in only** — save/resume needs a Google account by product
  decision; a signed-out ranking lives only in the current browser tab. The build page
  warns about this prominently before you start, since a large Thorough ranking is
  thousands of matchups.
- **Export** — copy as text, download CSV, or download JSON.

## How the ranking works

A knockout bracket eliminates half the field each round, so most votes tell you nothing
about final placing. Swiss (the format SongRank used to run on, the same one Magic: The
Gathering tournaments use) is a real improvement — every song plays every round instead of
being eliminated — but it still falls short of what a full, provably correct ranking needs.
Producing a correct total order of *n* items needs at least log₂(n!) comparisons (that many
yes/no answers to distinguish between every possible ordering): **≈1,684 for 256 songs**.
Eight Swiss rounds on 256 songs is only 8 × 128 = **1,024** comparisons — under the floor
before counting that Swiss also *wastes* comparisons re-pairing songs whose order a smarter
system would already treat as settled.

SongRank now uses an **adaptive pairwise ranking** engine instead:

- Every song carries a rating (Elo-style, starting at 1500) and an uncertainty score that
  shrinks as it plays more matchups. A surprising result moves a rating more than an
  expected one — the update's learning rate is scaled by the song's own current
  uncertainty, so a nearly-untested song can swing a lot on one result and a
  well-established one barely moves.
- Every matchup is picked fresh: whichever unplayed pair has the closest ratings and the
  most combined uncertainty, because that comparison carries the most information.
  Candidates are found in a bounded neighbourhood of the rating-sorted field rather than by
  scanning every possible pair, so this stays fast even at 256 songs. Repeat pairings are
  avoided until the whole pool of pairs has been exhausted.
- **Budget scales with list size:** roughly `1.25 × n × log₂(n)` matchups at the default
  Thorough depth — about 30 for 8 songs, 200 for 32, 2,560 for the full 256 — always above
  the log₂(n!) floor. Quick and Balanced trade some of that precision for a shorter
  session; the estimated count for each is shown before you commit. A field of 6 songs or
  fewer just plays every pair once — exact, and cheaper than being clever about it.
- **Anytime and early stop:** the ranking is valid after any number of votes, and a field
  where every adjacent pair in the standings is already clearly separated finishes before
  its estimated budget rather than grinding through it.
- **Decisive #1:** once the main phase ends, the leading few songs play a short extra round
  robin against each other so first place is earned by beating the other top contenders
  head to head, not just inherited from ratings.
- **Ties are information, not a skip:** an undecided matchup still counts as played and still
  shrinks both songs' uncertainty — "a listener compared these two and couldn't separate them"
  really does say something about where they sit. It just says it without inventing a winner.

Rankings saved before this change keep replaying through the Swiss engine exactly as
they always did — a ranking's format is fixed at creation and never silently
reinterpreted (see `Tournament.format` in `lib/types.ts`).

## Tech

Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind v4 · Auth.js v5
(Google) · Neon Postgres · deployed on Vercel.

## Running locally

```bash
npm install
npm run dev        # http://localhost:3003
```

**It runs with no environment variables set.** Pasting a list, searching, playing a full
ranking, seeing results, and the copy/CSV/JSON exports all work unconfigured. Each
variable below unlocks exactly one extra feature; anything missing degrades to a plain
message in the UI rather than a broken button.

| Variable | What it unlocks |
| --- | --- |
| `DATABASE_URL` | Neon Postgres connection. Use the **pooled** endpoint (host contains `-pooler`) — `lib/db.ts` sets `prepare: false` for it. |
| `AUTH_SECRET` | Session signing. Generate with `npx auth secret`. |
| `AUTH_GOOGLE_ID` | Google OAuth client ID. |
| `AUTH_GOOGLE_SECRET` | Google OAuth client secret. |
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
node --experimental-strip-types scripts/verify-ranking.ts
node --experimental-strip-types scripts/verify-swiss.ts
```

`verify-ranking.ts` is the adaptive engine's proof: it plays rankings across a spread of
sizes up to n = 256 (the true ceiling) under several voting policies and checks that
matchup counts track the budget formula, no pairing repeats before the pool is exhausted, a
lopsided field settles early, and — the check that actually proves the ranking works rather
than merely runs — a seeded true order under low-noise voting produces a final ranking that
correlates strongly with it.

`verify-swiss.ts` is kept for the legacy engine, which still has to replay rankings saved
before the adaptive engine existed: it plays rankings across n = 2..64 under several
voting policies and asserts correct round counts, no duplicate pairings within a round,
every song paired at most once per round, at most one bye per song, and exactly one
undefeated champion at the end.

## Licence

No licence specified yet.
