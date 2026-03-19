CREATE TABLE IF NOT EXISTS site_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  twitter_url TEXT,
  show_twitter INTEGER NOT NULL DEFAULT 1,
  telegram_url TEXT,
  show_telegram INTEGER NOT NULL DEFAULT 1,
  dexscreener_url TEXT,
  show_dexscreener INTEGER NOT NULL DEFAULT 1,
  pump_fun_url TEXT,
  token_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO site_settings (id)
SELECT 1
WHERE NOT EXISTS (SELECT 1 FROM site_settings WHERE id = 1);
