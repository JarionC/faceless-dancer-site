CREATE TABLE IF NOT EXISTS game_songs (
  id TEXT PRIMARY KEY,
  beat_entry_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 0,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(created_by_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_game_songs_enabled ON game_songs(is_enabled);

CREATE TABLE IF NOT EXISTS game_scores (
  id TEXT PRIMARY KEY,
  song_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  beat_entry_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  max_combo INTEGER NOT NULL DEFAULT 0,
  perfect INTEGER NOT NULL DEFAULT 0,
  great INTEGER NOT NULL DEFAULT 0,
  good INTEGER NOT NULL DEFAULT 0,
  poor INTEGER NOT NULL DEFAULT 0,
  miss INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(song_id) REFERENCES game_songs(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_game_scores_song ON game_scores(song_id);
CREATE INDEX IF NOT EXISTS idx_game_scores_user ON game_scores(user_id);
