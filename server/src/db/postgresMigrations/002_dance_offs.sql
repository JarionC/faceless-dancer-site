CREATE TABLE IF NOT EXISTS dance_offs (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  beat_entry_id TEXT NOT NULL,
  game_mode TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  required_player_count INTEGER NOT NULL CHECK (required_player_count >= 2 AND required_player_count <= 4),
  status TEXT NOT NULL,
  cancel_reason TEXT,
  ready_deadline_at TIMESTAMPTZ,
  countdown_started_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  winner_user_id TEXT REFERENCES users(id),
  is_draw INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dance_offs_status ON dance_offs(status);
CREATE INDEX IF NOT EXISTS idx_dance_offs_owner ON dance_offs(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_dance_offs_created_at ON dance_offs(created_at DESC);

CREATE TABLE IF NOT EXISTS dance_off_participants (
  id TEXT PRIMARY KEY,
  dance_off_id TEXT NOT NULL REFERENCES dance_offs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  public_key TEXT NOT NULL,
  display_name_snapshot TEXT,
  role TEXT NOT NULL,
  join_status TEXT NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ready_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  final_score INTEGER,
  final_accuracy NUMERIC(6, 2),
  UNIQUE (dance_off_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_dance_off_participants_dance_off ON dance_off_participants(dance_off_id);
CREATE INDEX IF NOT EXISTS idx_dance_off_participants_user ON dance_off_participants(user_id);

CREATE TABLE IF NOT EXISTS dance_off_events (
  id BIGSERIAL PRIMARY KEY,
  dance_off_id TEXT NOT NULL REFERENCES dance_offs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload_json TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dance_off_events_dance_off ON dance_off_events(dance_off_id, created_at DESC);
