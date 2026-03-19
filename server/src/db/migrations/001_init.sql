CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL UNIQUE,
  is_admin INTEGER NOT NULL DEFAULT 0,
  is_holder INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS nonces (
  id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  nonce TEXT NOT NULL,
  message TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_nonces_public_key ON nonces(public_key);
CREATE INDEX IF NOT EXISTS idx_nonces_nonce ON nonces(nonce);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  notes TEXT,
  desired_start TEXT NOT NULL,
  desired_end TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_submissions_user_id ON submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  uploader_user_id TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  bunny_object_path TEXT NOT NULL,
  bunny_public_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(submission_id) REFERENCES submissions(id),
  FOREIGN KEY(uploader_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_assets_submission_id ON assets(submission_id);

CREATE TABLE IF NOT EXISTS schedule_slots (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(submission_id) REFERENCES submissions(id)
);
