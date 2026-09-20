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

-- ---------------------------------------------------------------------------
-- Soft delete
-- ---------------------------------------------------------------------------

-- When this ranking was deleted, or NULL if it wasn't.
--
-- Deleting is now a two-stage thing: the row is marked here and disappears
-- from every read path, and only a second, explicit "delete forever" removes
-- it. The reason is the obvious one -- a ranking can be sixteen hundred
-- decisions of someone's actual attention, and a hard DELETE behind a single
-- unconfirmed button is not a proportionate thing to put next to it. There is
-- no undo for a DELETE and no copy kept anywhere, so the row itself has to be
-- the undo.
--
-- Every read in lib/queries.ts, lib/people.ts and lib/friends.ts filters on
-- `deleted_at IS NULL`. That includes the public feed, profile counts and the
-- comparison lookups: a deleted ranking must not go on being visible to
-- strangers just because its owner can still get it back.
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Partial, because the overwhelming majority of rows have a NULL here and the
-- only query that wants the others is the "recently deleted" list for one
-- user. Indexing the whole column would be paying for every live row to find
-- the handful that aren't.
CREATE INDEX IF NOT EXISTS tournaments_deleted_idx
  ON tournaments (user_id, deleted_at DESC)
  WHERE deleted_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------

-- In-app notices: someone followed you, or someone used one of your public
-- lists as the template for their own ranking.
--
-- Both events are already public facts -- follower lists are on every profile,
-- and a copy credits its source -- so this surfaces things the person could
-- find by looking, rather than exposing anything new.
--
-- `actor_id` and `tournament_id` both cascade on delete. If the person who
-- followed you deletes their account, a notice saying "someone followed you"
-- with nobody attached is worse than no notice, so it goes with them.
CREATE TABLE IF NOT EXISTS notifications (
  id             BIGSERIAL PRIMARY KEY,
  -- Who is being told.
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Who did the thing.
  actor_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'follow' or 'copy'.
  kind           TEXT NOT NULL,
  -- The ranking of YOURS that was copied. Null for a follow.
  tournament_id  TEXT REFERENCES tournaments(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at        TIMESTAMPTZ,
  -- Nobody is ever told about their own actions: copying your own list, or the
  -- self-follow the friends table already forbids.
  CHECK (user_id <> actor_id)
);

-- One notice per person per thing, forever.
--
-- This is the anti-spam rule and it is deliberately strict. Without it,
-- following and unfollowing someone in a loop generates an unbounded stream of
-- "X followed you", and re-copying a list does the same -- both trivially
-- abusable and, more commonly, just annoying when someone is undecided. A
-- second follow from the same person is not news.
--
-- `coalesce` because a follow has no tournament and Postgres treats NULLs as
-- distinct in a unique index, which would let duplicate follow rows through.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_unique_event_idx
  ON notifications (user_id, actor_id, kind, coalesce(tournament_id, ''));

-- The list, newest first, for one person.
CREATE INDEX IF NOT EXISTS notifications_user_idx
  ON notifications (user_id, created_at DESC);

-- The unread badge asks only this question, on every page load, so it gets an
-- index that contains only the rows it cares about.
CREATE INDEX IF NOT EXISTS notifications_unread_idx
  ON notifications (user_id)
  WHERE read_at IS NULL;

-- ---------------------------------------------------------------------------
-- Spotify playlist export
-- ---------------------------------------------------------------------------

-- Authorisation to write playlists on one person's Spotify account.
--
-- One row per SongRank user, keyed by our own user id: Spotify is a
-- capability here, not an identity. Nobody signs in with it and nobody's
-- account IS it, so this deliberately does not touch auth.ts, which stays
-- Google-only with a JWT session and no database adapter. Disconnecting is
-- then just deleting a row, with no question about what it does to a session.
--
-- The tokens are stored ENCRYPTED (see lib/spotifyAuth.ts), not as Spotify
-- returned them. A refresh token does not expire: anyone holding one can mint
-- access tokens and write to that account indefinitely, so this column is a
-- live credential and a database dump would be a credential leak. Neon
-- encrypts at rest, which protects the disk but not a dump, a stray backup, or
-- anything that gets query access. The encryption key is derived from
-- AUTH_SECRET, which lives in the environment and is NOT in the database, so
-- neither half is useful alone.
--
-- Rotating AUTH_SECRET therefore invalidates every row here. That is the
-- correct trade and it fails safely -- decryption returns null and the person
-- is asked to reconnect, which is an ordinary recoverable state rather than an
-- error.
CREATE TABLE IF NOT EXISTS spotify_accounts (
  user_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- The authorised account's own Spotify id, needed to create a playlist
  -- under it. Not a secret, and not encrypted.
  spotify_user_id    TEXT NOT NULL,
  access_token_enc   TEXT NOT NULL,
  refresh_token_enc  TEXT NOT NULL,
  -- When the ACCESS token stops working. The refresh token has no expiry,
  -- which is exactly why it is the valuable half.
  expires_at         TIMESTAMPTZ NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Remembered answers to "what is this song on Spotify".
--
-- Spotify meters search per APPLICATION, and an app in development mode gets a
-- small allowance -- small enough that a long ranking exhausts it and the app
-- is locked out for a while afterwards. Under that constraint a search result
-- is not a cheap thing to fetch again; it is the scarcest resource the feature
-- has. So every answer is kept, and no song is ever looked up twice.
--
-- SHARED ACROSS USERS ON PURPOSE, and keyed by the song rather than by the
-- ranking or the person. "Let It Go by Idina Menzel" resolves to the same
-- Spotify track whoever is asking -- it is public catalogue data, not anything
-- about a user -- so one person exporting a Disney ranking makes the next
-- person's export of the same songs free. That is the difference between the
-- quota being spent once and being spent per person per attempt.
--
-- Keys are normalised (see normalizeForMatch in lib/parse.ts, and
-- primaryArtist in lib/itunes.ts) so trivial differences in punctuation,
-- casing or a long credit string all land on the same row.
CREATE TABLE IF NOT EXISTS spotify_track_matches (
  -- normalizeForMatch(title)
  title_key     TEXT NOT NULL,
  -- normalizeForMatch(primaryArtist(artist)); '' when the song has no artist.
  artist_key    TEXT NOT NULL,
  -- NULL means a remembered MISS: Spotify was asked and had nothing. Worth
  -- storing precisely because it cost a request to learn, and re-learning it
  -- costs another one.
  track_uri     TEXT,
  track_title   TEXT,
  track_artist  TEXT,
  track_album   TEXT,
  -- 'high' | 'partial' | 'none', as scoreCandidate returned it.
  confidence    TEXT NOT NULL,
  checked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (title_key, artist_key)
);

-- Misses are re-checked after a while (a track really can be added to the
-- catalogue later); hits are not, because a track that exists keeps existing.
-- The index serves the sweep that finds stale misses.
CREATE INDEX IF NOT EXISTS spotify_track_matches_stale_idx
  ON spotify_track_matches (checked_at)
  WHERE track_uri IS NULL;
