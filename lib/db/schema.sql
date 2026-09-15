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
  songs         JSONB NOT NULL,
  votes         JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The `id` primary key doubles as the public /t/[id] slug (see Tournament.id
-- in lib/types.ts), generated client-side with crypto.randomUUID() before
-- the first save -- so the history list and the "resume in progress" link
-- both just read it straight off the row, no separate public-id column.
CREATE INDEX IF NOT EXISTS tournaments_user_idx
  ON tournaments (user_id, updated_at DESC);
