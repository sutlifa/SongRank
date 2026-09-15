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
