ALTER TABLE game_scores ADD COLUMN game_mode TEXT NOT NULL DEFAULT 'step_arrows';

CREATE INDEX IF NOT EXISTS idx_game_scores_song_mode_difficulty ON game_scores(song_id, game_mode, difficulty);
CREATE INDEX IF NOT EXISTS idx_game_scores_entry_mode_difficulty ON game_scores(beat_entry_id, game_mode, difficulty);
