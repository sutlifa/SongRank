@AGENTS.md

# SongRank — agent context

Read this before touching anything. It exists so you don't spend tokens
rediscovering what previous sessions already paid to learn.

- **Live:** https://song-rankings.vercel.app · **Repo:** `sutlifa/SongRank` (public, branch `main`)
- **Vercel project:** `song-rank` (team `sutlifa-7699s-projects`). Push to `main` = deploy.
- Team loop: **Builder → Tester → Deployer**. The Tester never edits source, only
  reports; the Builder never declares itself done (only a clean Tester pass ends
  the build phase); the Deployer never ships with open bugs. The full house
  contract lives in the workspace's `AGENT-TEAM.md`, deliberately *not* copied
  here — this file is the project-specific half, kept short on purpose.

## What it is

Paste or search for a list of songs → compare them two at a time with a short
audio clip → an adaptive pairwise ranking engine narrows to one winner and a
full ranked list → export as text/CSV/JSON.

## Stack (pinned — don't bump casually)

Next.js **16.3.5** App Router · React **19.3.0** · TypeScript strict ·
Tailwind **v4** (configured via `@theme` in `app/globals.css`; **there is no
`tailwind.config.ts`**) · `next-auth@5.0.0-beta.32` (Google only, JWT, no DB
adapter) · `postgres` (postgres.js) against Neon · `@vercel/analytics`.

## Next 16 gotchas (newer than most training data)

Docs ship in `node_modules/next/dist/docs/` — read
`01-app/02-guides/upgrading/version-16.md` before writing route/page code.

- `params` / `searchParams` / `cookies()` / `headers()` are **Promises**. Await them.
- `middleware.ts` → **`proxy.ts`**. We use neither; guards are per-route.
- `next lint` is gone. `npm run lint` runs the ESLint CLI against flat config.
- Turbopack is default for dev *and* build.

## Core architecture — read this before changing state handling

**A ranking (a `Tournament` in code) is `{ songs, votes }` and nothing else.** Rounds, pairings,
standings, the champion and progress are all *derived* by replaying the vote
log (`derive()`). Persistence therefore means saving songs + votes; there is
nothing else to store. Don't add denormalised state — it will drift.

```
app/            routes only
components/     client components
lib/
  db.ts         single postgres client; falls back to "" so `next build` works
                without DATABASE_URL. `prepare: false` is REQUIRED (Neon pooled).
  db/schema.sql one idempotent file — the entire DDL surface. No migration tool.
  parse.ts      pure paste-parsing heuristics
  itunes.ts     preview/artwork lookup
scripts/
  migrate.ts    applies schema.sql
  verify-*.ts   headless invariant checks — run them, don't eyeball
auth.ts         NextAuth config at repo root
```

## Non-negotiable behaviours

- **Auth is optional.** Every tool works signed out. Signing in only adds saved
  history. A signed-out user must never hit a wall.
- **Unconfigured degrades honestly.** The app builds and runs with *zero* env
  vars. Missing config shows a plain message — never a dead button, a spinner
  that never resolves, or a 500.
- **API routes:** guard → try/catch → user-facing message. `console.error` with
  an UPPERCASE label (server-only). Status codes honestly: 400 bad input, 401 no
  session, 413 too large, 500 genuine fault. The `error` string is read by a
  human — never a stack trace or a column name.
- **Comment style:** explain *why*, at length, wherever a reader would otherwise
  assume a mistake. A comment restating the code is noise; one that stops the
  next reader "re-fixing" a deliberate choice is the point.

## Environment

| Var | Unlocks |
| --- | --- |
| `DATABASE_URL` | Neon. **Pooled endpoint** (host has `-pooler`). |
| `AUTH_SECRET` | Session signing (`npx auth secret`). |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google sign-in. |
| `SONGRANK_PREVIEW_FIXTURES=1` | Test-only: deterministic fixture songs + synthesized WAV tones. |

**Google sign-in also requires `DATABASE_URL`** — sign-in writes a user row, so
`isAuthConfigured()` deliberately checks both. Credentials without a database
would authenticate someone into a write with nowhere to go.

Google redirect URI: `https://song-rankings.vercel.app/api/auth/callback/google`

## Sandbox realities (remote sessions)

- **`itunes.apple.com` is blocked by the egress proxy (403 on CONNECT).** So is
  `song-rankings.vercel.app`. This is environment policy, not app failure —
  never report it as a broken deploy. Use `SONGRANK_PREVIEW_FIXTURES=1` to test
  the full search → play → vote loop offline.
- **No Vercel CLI or token.** Deployment happens via `git push origin main`.
- Chromium + Playwright are preinstalled (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`).
  Never run `playwright install`. Install the `playwright` npm package in a
  scratch dir — **never** add it to this repo's `package.json`.
- Dev server port: **3003**.

## Commands

```bash
npm run lint && npm run typecheck && npm run build   # build must pass with NO env vars
node --experimental-strip-types scripts/verify-swiss.ts   # engine invariants (~9s)
npm run db:migrate                                    # applies lib/db/schema.sql
```

## Bugs already paid for — do not reintroduce

Each of these shipped or nearly shipped. They are cheap to cause and expensive
to find.

1. **Never read `localStorage` in a `useState` initializer.** It returns `null`
   on the server and real data on the client, so the first render disagrees →
   hydration mismatch on every reload. Initialize null, populate in `useEffect`.
2. **`sync` must render in *every* branch** of `TournamentPlayer` / `ResultsView`,
   including loading and not-found. `useTournamentLoader` leaves `resolved` false
   when auth is on and waits for `TournamentServerSync` — which *is* `sync` — to
   flip it. Returning early without rendering it deadlocks signed-in users
   forever. Signed-out testing cannot catch this.
3. **`setState(updater)` does not run the updater synchronously.** Don't mutate a
   ref on the next line and expect the updater to read the old value — snapshot
   it into a local first. This silently froze the progress bar on undo.
4. **ESLint:** use `eslint-config-next`'s native flat exports. `FlatCompat` crashes
   the config validator against `eslint-plugin-react-hooks@7`.
5. **Tailwind v4:** `@apply` only reaches real utilities. Declare shared primitives
   with `@utility`, not `@layer components`.
6. **Copyright year is hardcoded** in `SiteFooter`. A computed year bakes at build
   time on the server and reads live on the client — mismatch across New Year.
7. `react-hooks` v7 flags refs read during render and sync `setState` in effects as
   hard errors. The codebase defers those by one tick; follow the existing pattern.

## Sharing

`tournaments.visibility` defaults `'private'` — never change that default. Access
control is IN the SQL (`getPublicTournament` takes no userId and filters on
`visibility='public'`), never applied by a caller. `/r/[id]` is a separate
server-rendered route for other people's rankings; do NOT turn `/t/[id]` into a
read-only mode instead — that route autosaves every vote.

`lib/people.ts` returns NO email field at all. Username/name search = substring;
email search = exact whole address only (prevents harvesting). Usernames are
nullable, never backfilled, unique on `lower(username)` (constraint violation,
not a SELECT-first check). `lib/username.ts` = pure rules + `profilePath`;
`profilePath` lives there, not in people.ts, because client components import it
and people.ts pulls in `postgres`. All-digit handles are banned so `/u/<handle>`
stays unambiguous with the numeric-id form that old links use.
`UsernameBanner` prompts any signed-in account without one, site-wide. It asks
via `GET /api/account/username` rather than calling `auth()` in the root layout,
which would make every statically prerenderable page dynamic forever to answer a
once-per-account question.

Friends are one-way and gate nothing; they only order `/browse`.

**A copy inherits the songs and nothing else** — not depth, format or clip
length. The copier picks depth before it starts; an unreadable choice falls back
to `DEFAULT_DEPTH`, never to the source's. Inheriting meant one person's Quick
was silently imposed on everyone who copied their list.

`scripts/verify-sharing.ts` covers all of this against a local Postgres. It
truncates `users`, so it hard-refuses any non-localhost `DATABASE_URL`.

## Ready-made lists

`lib/starterLists.ts` = fixed curated lists as `{title, artist}` pairs (pure, no I/O).
`lib/charts.ts` = the one live list, off Apple's keyless chart feed, 6h revalidate,
`null` on any failure so the card just isn't rendered. `loadStarter(id)` resolves
either and lives in charts.ts so the dependency only points pure → network.

Starters skip `lib/parse.ts` on purpose — the parser guesses which half of a line
is the title, and here we wrote it down. They enter `/new` as drafts with
`resolved: null`, so everything downstream is the ordinary flow.

## Ranking engine

Swiss was replaced because it cannot produce a reliable full ranking: a correct
total order of *n* items needs ≥ log₂(n!) comparisons (≈1,684 for 256 songs) and
8 Swiss rounds only buys 1,024. The engine is now adaptive pairwise (Glicko-style
rating + uncertainty), pairing the least-predictable matchup each time, with
anytime stopping and a top-cut playoff to guarantee a decisive #1.

Target matchups ≈ `1.25 × n × log₂(n)`, with a full round-robin at n ≤ 6 and an
early stop once every adjacent pair separates confidently
(`adjacentSettledFraction`).

The displayed "N% settled" is a **different** measure (`rankingConfidence`):
fraction of *all* pairs whose gap beats their combined RD. Don't merge the two —
the adjacent/absolute-gap version reads 0% for every large list (neighbours sit
~5 rating points apart; the threshold is 85) and that was a shipped bug.

A matchup can also be answered "flip a coin" (`Vote.tie`), applied as an Elo draw:
0.5 each, no win/loss credited, excluded from the head-to-head tiebreak map, but
still counted as played so RD falls. `tie` is written only when true, so a ranking
played without it serialises exactly as it did before the field existed. Swiss has
no draw and `UnifiedDerived.supportsTies` is false there, which hides the button.

**Save/resume is a signed-in feature by product decision.** Signed-out users are
warned before starting that progress will not be saved.
