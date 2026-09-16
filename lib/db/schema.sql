-- SongRank schema. Idempotent: every statement is guarded so
-- `npm run db:migrate` can be re-run against an existing database.

CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  google_id   TEXT NOT NULL UNIQUE,
  email       TEXT NOT NULL UNIQUE,
  name        TEXT,
  image       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A saved tournament. `songs` and `votes` are the *only* things that define a
-- tournament -- see lib/types.ts's Tournament comment and lib/swiss.ts's
-- `derive`. Rounds, pairings, standings and the champion are all recomputed
-- from these two columns on every load, so saving is just persisting the
-- vote log next to the seeded song list; there is nothing else to write.
--
-- Both are JSONB rather than normalised tables for the same reason
-- saved_analyses in the MTG app stores its decklists as JSON: this data is
-- only ever read and written whole, by one owner, and never queried or
-- aggregated across users. A `songs` array of ~10-256 objects and a `votes`
-- array of a few hundred `{pairingId, winnerId}` pairs is small; normalising
-- either would add joins that nothing here needs.
CREATE TABLE IF NOT EXISTS tournaments (
  id            TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  clip_seconds  SMALLINT NOT NULL DEFAULT 15,
  -- Which engine built this tournament's pairings -- 'swiss' (lib/swiss.ts)
  -- or 'adaptive' (lib/ranking.ts). Defaults to 'swiss' so a row written
  -- before this column existed keeps replaying through the engine it was
  -- actually played under; see lib/types.ts's TournamentFormat comment.
  format        TEXT NOT NULL DEFAULT 'swiss',
  -- Only meaningful when format = 'adaptive'; null for every 'swiss' row,
  -- including every row that predates this column.
  depth         TEXT,
  songs         JSONB NOT NULL,
  votes         JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- `CREATE TABLE IF NOT EXISTS` only helps a table that doesn't exist yet --
-- every production deployment before this feature already has `tournaments`
-- without these two columns, so they need adding explicitly for the same
-- "safe to re-run" guarantee the rest of this file has. The DEFAULT here
-- matches the one on the table definition above for the same reason: an
-- existing row with no format is a Swiss tournament, full stop.
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS format TEXT NOT NULL DEFAULT 'swiss';
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS depth TEXT;

-- The `id` primary key doubles as the public /t/[id] slug (see Tournament.id
-- in lib/types.ts), generated client-side with crypto.randomUUID() before
-- the first save -- so the history list and the "resume in progress" link
-- both just read it straight off the row, no separate public-id column.
CREATE INDEX IF NOT EXISTS tournaments_user_idx
  ON tournaments (user_id, updated_at DESC);

-- ---------------------------------------------------------------------------
-- Sharing: public rankings, friends, and copied lists
-- ---------------------------------------------------------------------------

-- Whether anyone other than the owner can see this ranking: 'private' or
-- 'public'.
--
-- The DEFAULT is the load-bearing part. Every row that already exists was
-- saved by someone who was never asked whether it could be shown to
-- strangers, and a ranking's song list plus its vote log is a genuinely
-- personal thing. So the default is 'private' on both the column and the
-- ALTER below, and going public is only ever an explicit act by the owner
-- (see setTournamentVisibility in lib/queries.ts, reachable only from the
-- owner's own results screen). There is no path that makes a ranking public
-- as a side effect of anything else.
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private';

-- The ranking this one was copied from, when it was copied rather than built
-- (see copyTournament in lib/queries.ts). Carried purely so a copy can credit
-- its source and offer the "compare our picks" link, which is the whole point
-- of copying someone's list in the first place.
--
-- ON DELETE SET NULL, not CASCADE: if the original is deleted, the copy is
-- still the copier's own ranking with their own votes in it. Cascading would
-- delete someone else's work because a third party tidied up their history,
-- which would be indefensible.
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS source_tournament_id TEXT
  REFERENCES tournaments(id) ON DELETE SET NULL;

-- Browsing public rankings is "newest first, everything public", so the
-- index leads with the filter column and carries the sort.
CREATE INDEX IF NOT EXISTS tournaments_public_idx
  ON tournaments (visibility, updated_at DESC);

-- Friends.
--
-- Deliberately ONE-WAY, and a plain (user_id, friend_id) pair rather than a
-- request/accept handshake with a pending state. The reason is that
-- friendship here gates nothing: a private ranking stays private to its owner
-- whoever they are friends with, and a public one is public to the whole
-- internet. All this relation does is decide whose rankings float to the top
-- of your browse page. Asking someone's permission to sort them higher in
-- your own feed would be ceremony protecting nothing, and it would add a
-- pending state, a decline path and a notification surface to maintain.
--
-- If both people add each other, that is a mutual friendship and both
-- browse pages reflect it. Nothing here needs to know that happened.
CREATE TABLE IF NOT EXISTS friends (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, friend_id),
  -- Adding yourself would put your own rankings in the "your friends" section
  -- of your own browse page, which reads as a bug every time.
  CHECK (user_id <> friend_id)
);

-- "Whose rankings should I show first" is the only question ever asked of
-- this table, and it is always asked about one user at a time.
CREATE INDEX IF NOT EXISTS friends_user_idx ON friends (user_id);

-- Finding a person by the start of their name. Postgres can only use a plain
-- btree index for a prefix match on a lowercased column, which is exactly the
-- search lib/people.ts performs.
CREATE INDEX IF NOT EXISTS users_name_lower_idx ON users (lower(name));

-- ---------------------------------------------------------------------------
-- Usernames
-- ---------------------------------------------------------------------------

-- The handle people are found and addressed by, so nobody has to hand out an
-- email address to be findable. See lib/username.ts for the rules.
--
-- Nullable, and deliberately not backfilled: every account that existed before
-- this column did was created without ever being asked, and a handle invented
-- for someone by a string transform is both a small indignity and usually
-- worse than what they would pick themselves. So an account simply has no
-- username until its owner sets one, and every read path treats that as an
-- ordinary state rather than an error.
ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;

-- Uniqueness is case-insensitive: "@Sam" and "@sam" must never be two people,
-- because the difference is invisible when spoken and nearly invisible when
-- read. lib/username.ts lowercases on the way in, so this index is both the
-- constraint and the lookup path for a profile at /u/<handle>.
--
-- A unique INDEX rather than a UNIQUE CONSTRAINT because a constraint cannot
-- be declared over an expression. Postgres treats NULLs as distinct, so any
-- number of accounts can go on having no username at all.
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_key ON users (lower(username));
