CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL UNIQUE,
  is_admin INTEGER NOT NULL DEFAULT 0,
  is_holder INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nonces (
  id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  nonce TEXT NOT NULL,
  message TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_nonces_public_key ON nonces(public_key);
CREATE INDEX IF NOT EXISTS idx_nonces_nonce ON nonces(nonce);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  notes TEXT,
  desired_start TIMESTAMPTZ NOT NULL,
  desired_end TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_submissions_user_id ON submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  uploader_user_id TEXT NOT NULL REFERENCES users(id),
  asset_type TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  bunny_object_path TEXT NOT NULL,
  bunny_public_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assets_submission_id ON assets(submission_id);

CREATE TABLE IF NOT EXISTS schedule_slots (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS site_settings (
  id INTEGER PRIMARY KEY,
  twitter_url TEXT,
  show_twitter INTEGER NOT NULL DEFAULT 1,
  telegram_url TEXT,
  show_telegram INTEGER NOT NULL DEFAULT 1,
  dexscreener_url TEXT,
  show_dexscreener INTEGER NOT NULL DEFAULT 1,
  pump_fun_url TEXT,
  token_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  youtube_url TEXT,
  show_youtube INTEGER NOT NULL DEFAULT 1,
  youtube_live_channel_id TEXT,
  CONSTRAINT site_settings_single_row CHECK (id = 1)
);

INSERT INTO site_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS game_songs (
  id TEXT PRIMARY KEY,
  beat_entry_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 0,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cover_image_file_name TEXT
);

CREATE INDEX IF NOT EXISTS idx_game_songs_enabled ON game_songs(is_enabled);

CREATE TABLE IF NOT EXISTS game_scores (
  id TEXT PRIMARY KEY,
  song_id TEXT NOT NULL REFERENCES game_songs(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  beat_entry_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  max_combo INTEGER NOT NULL DEFAULT 0,
  perfect INTEGER NOT NULL DEFAULT 0,
  great INTEGER NOT NULL DEFAULT 0,
  good INTEGER NOT NULL DEFAULT 0,
  poor INTEGER NOT NULL DEFAULT 0,
  miss INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  difficulty TEXT NOT NULL DEFAULT 'normal',
  game_mode TEXT NOT NULL DEFAULT 'step_arrows'
);

CREATE INDEX IF NOT EXISTS idx_game_scores_song ON game_scores(song_id);
CREATE INDEX IF NOT EXISTS idx_game_scores_user ON game_scores(user_id);
CREATE INDEX IF NOT EXISTS idx_game_scores_song_difficulty ON game_scores(song_id, difficulty);
CREATE INDEX IF NOT EXISTS idx_game_scores_entry_difficulty ON game_scores(beat_entry_id, difficulty);
CREATE INDEX IF NOT EXISTS idx_game_scores_song_mode_difficulty ON game_scores(song_id, game_mode, difficulty);
CREATE INDEX IF NOT EXISTS idx_game_scores_entry_mode_difficulty ON game_scores(beat_entry_id, game_mode, difficulty);

CREATE TABLE IF NOT EXISTS game_control_defaults (
  id INTEGER PRIMARY KEY,
  analysis_overrides_json TEXT,
  lane_strength_thresholds_json TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT game_control_defaults_single_row CHECK (id = 1)
);

INSERT INTO game_control_defaults (
  id,
  analysis_overrides_json,
  lane_strength_thresholds_json
)
VALUES (
  1,
  '{
    "hopLength": 512,
    "onsetMinStrength": 0.1,
    "onsetMinDistanceSeconds": 0.11,
    "adaptiveWindowSeconds": 0.45,
    "strictK": 1.15,
    "permissiveK": 0.62,
    "gapTriggerSeconds": 0.23,
    "sustainMinDurationSeconds": 0.2,
    "sustainMergeGapSeconds": 0.12,
    "sustainBridgeFloor": 0.28,
    "sustainMaxPitchJumpSemitones": 1.2,
    "sustainSplitOnPitchChange": true,
    "sustainMinPitchConfidence": 0.2,
    "sustainEnableContinuousPitchSplit": true,
    "sustainPitchSplitThresholdSemitones": 0.35,
    "sustainPitchSplitMinSegmentSeconds": 0.02,
    "sustainPitchSplitMinVoicedProbability": 0.1,
    "lowFmin": 20,
    "lowFmax": 3500,
    "midFmin": 5000,
    "midFmax": 7000,
    "highFmin": 7000,
    "highFmax": 12000,
    "lowWeight": 1.15,
    "midWeight": 1,
    "highWeight": 0.9
  }',
  '{
    "hybrid_band_low": 0.2,
    "hybrid_band_mid": 0.51,
    "hybrid_band_high": 0.08,
    "hybrid_band_combined": 0.08,
    "hybrid_sustain": 0.38
  }'
)
ON CONFLICT (id) DO NOTHING;

