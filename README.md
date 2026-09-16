# SongRank

Turn a list of songs into a ranked list by comparing them two at a time, with a short
audio clip of each to jog your memory. An adaptive pairwise ranking engine picks each
matchup to be the one whose outcome teaches it the most, so the whole list ends up
ranked — not just the winner — using far fewer comparisons than a fixed bracket or
round schedule would need.

**Live:** https://song-rankings.vercel.app

## Features

- **Ready-made lists** — start in one click from a curated list (all-time greats, a genre,
  a decade, the Beatles, Disney) or from what's charting on Apple Music right now. Every
  one opens in the normal build screen, so it can be edited, renamed and added to before
  anything starts. Browse them at `/starters`.
- **Or load songs two ways** — paste a list, or search for them one by one.
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
- **Share, copy and compare** — any saved ranking can be made public (private by default,
  always). Public ones show up on `/browse`, friends first. Copy someone's song list into a
  ranking of your own — their votes don't come with it, and nothing you do touches their
  ranking — then compare the two: rank correlation, biggest disagreements, and a full
  side-by-side table.
- **People** — pick a `@username` and friends can find you without either of you handing out
  an email address. Search by username or display name. Anyone signed in without a handle gets
  a site-wide prompt until they pick one, since accounts made before usernames existed are
  otherwise unfindable without anyone realising. Following is one-way and private: it only
  decides whose rankings come first on Browse.

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

## Ready-made lists

`lib/starterLists.ts` holds the fixed ones as `{ title, artist }` pairs — adding a list means
adding an entry to that array and nothing else. They deliberately skip `lib/parse.ts`: the
parser exists to *guess* which half of a pasted line is the title, and here we already know,
so a starter arrives as structured drafts and joins the normal `/new` flow at preview
resolution.

`lib/charts.ts` is the one that isn't fixed — Apple's public, keyless chart feed, cached for
six hours. Every failure path returns `null` and the card is simply not shown, so a feed
outage costs a card rather than a page.

## Sharing

`tournaments.visibility` defaults to `'private'`, on the column and on the `ALTER` — every
row that already existed was saved by someone who was never asked, so nothing becomes
visible without an explicit act by its owner.

Access control lives in the SQL, not in a caller. `getPublicTournament` has no `userId`
parameter at all and filters on `visibility = 'public'` itself, so there is no version of
"forgot to check" available to a page. Someone else's public ranking is rendered by
`/r/[id]`, a separate server-rendered route rather than a read-only mode of `/t/[id]` —
pointing the interactive player (which autosaves every vote) at a ranking you don't own
would put a stranger's write one forgotten branch away.

The people directory **returns no email address at all**, masked or otherwise — that is what
usernames are for. Usernames and display names are searchable by substring; an email matches
only as a complete address, which keeps "find the friend who hasn't picked a handle yet"
working without letting the directory be walked for addresses.

Usernames are nullable and never backfilled: an account created before they existed simply
has none, and every read path treats that as ordinary. Uniqueness is case-insensitive, via a
unique index on `lower(username)` — caught as a constraint violation rather than checked with
a SELECT first, which would be a race. `lib/username.ts` holds the rules (including why an
all-digit handle is refused: `/u/<handle>` still accepts a numeric id so links shared before
usernames existed keep working, and the two must never be ambiguous). `profilePath` lives in
that module rather than `lib/people.ts` because client components need it and `lib/people.ts`
imports the database driver.

Friendship is **one-way** and gates nothing — it only decides ordering on `/browse`. See the
`friends` table comment in `lib/db/schema.sql` for why there is no request/accept handshake.

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
node --experimental-strip-types scripts/verify-starters.ts
node --experimental-strip-types scripts/verify-compare.ts
node --experimental-strip-types scripts/verify-username.ts

# Needs a throwaway local Postgres; refuses to run against a remote host.
DATABASE_URL=postgres://... \
  node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/verify-sharing.ts
```

`verify-ranking.ts` is the adaptive engine's proof: it plays rankings across a spread of
sizes up to n = 256 (the true ceiling) under several voting policies and checks that
matchup counts track the budget formula, no pairing repeats before the pool is exhausted, a
lopsided field settles early, and — the check that actually proves the ranking works rather
than merely runs — a seeded true order under low-noise voting produces a final ranking that
correlates strongly with it.

`verify-starters.ts` checks the hand-typed data in `lib/starterLists.ts`, where every way of
being wrong is silent: a duplicate id hides a list behind another, a song repeated inside a
list is silently de-duplicated on import so the card over-promises, and a stray empty string
becomes a song nothing can match. It also prints each list's artist concentration, since a
genre list that has drifted to a third one artist wastes its most informative early matchups.

`verify-compare.ts` proves the two-pass song matching in `lib/compare.ts` — by id first (so a
copied list matches exactly even after a "Change version" swap rewrites a title), then by
normalised text (so two independently built lists still line up) — plus that ranks are
renumbered within the shared songs and that a single shared song reports no correlation
rather than a flattering 1.0.

`verify-username.ts` covers the handle rules, each of which exists to stop something specific
and none of which fails loudly if lost: an all-digit handle makes `/u/<handle>` ambiguous with
a user id, a reserved word lets someone be `@support`, and a case-sensitive comparison lets
`@Sam` and `@sam` be two people.

`verify-sharing.ts` is the one script that needs a real database, because what it checks *is*
the SQL: a missing `WHERE` clause doesn't throw, doesn't fail a type check and doesn't look
wrong on screen — it just hands out a private ranking. It asserts every access boundary, that
copying takes songs but not votes and leaves the original untouched, that email search can't
be walked for addresses, and that deleting an account cascades without taking someone else's
copy with it. **It truncates the users table**, so it refuses to run unless `DATABASE_URL`
points at localhost — a refusal that is deliberately not overridable by a flag.

`verify-swiss.ts` is kept for the legacy engine, which still has to replay rankings saved
before the adaptive engine existed: it plays rankings across n = 2..64 under several
voting policies and asserts correct round counts, no duplicate pairings within a round,
every song paired at most once per round, at most one bye per song, and exactly one
undefeated champion at the end.

## Licence

No licence specified yet.
