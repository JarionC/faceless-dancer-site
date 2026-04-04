ALTER TABLE game_scores ADD COLUMN difficulty TEXT NOT NULL DEFAULT 'normal';

CREATE INDEX IF NOT EXISTS idx_game_scores_song_difficulty ON game_scores(song_id, difficulty);
CREATE INDEX IF NOT EXISTS idx_game_scores_entry_difficulty ON game_scores(beat_entry_id, difficulty);
