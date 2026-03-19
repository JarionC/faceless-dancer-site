ALTER TABLE site_settings ADD COLUMN youtube_url TEXT;
ALTER TABLE site_settings ADD COLUMN show_youtube INTEGER NOT NULL DEFAULT 1;
