import type { SiteSettings } from "@faceless/shared/dist/types/siteSettings.js";
import { pool } from "../../db/postgres.js";
import { env } from "../../config/env.js";

interface SiteSettingsRow {
  twitter_url: string | null;
  show_twitter: number;
  youtube_url: string | null;
  show_youtube: number;
  youtube_live_channel_id: string | null;
  telegram_url: string | null;
  show_telegram: number;
  dexscreener_url: string | null;
  show_dexscreener: number;
  pump_fun_url: string | null;
  token_address: string | null;
}

async function readRow() {
  const result = await pool.query<SiteSettingsRow>(
    `SELECT twitter_url, show_twitter, youtube_url, show_youtube, youtube_live_channel_id, telegram_url, show_telegram, dexscreener_url, show_dexscreener, pump_fun_url, token_address
     FROM site_settings
     WHERE id = 1
     LIMIT 1`
  );
  return result.rows[0];
}

export async function getSiteSettings(): Promise<SiteSettings> {
  const row = await readRow();

  return {
    twitterUrl: row?.twitter_url ?? env.SITE_TWITTER_URL,
    showTwitter: row ? row.show_twitter === 1 : env.siteShowTwitter,
    youtubeUrl: row?.youtube_url ?? env.SITE_YOUTUBE_URL,
    showYoutube: row ? row.show_youtube === 1 : env.siteShowYoutube,
    youtubeLiveChannelId: row?.youtube_live_channel_id ?? env.SITE_YOUTUBE_LIVE_CHANNEL_ID,
    telegramUrl: row?.telegram_url ?? env.SITE_TELEGRAM_URL,
    showTelegram: row ? row.show_telegram === 1 : env.siteShowTelegram,
    dexscreenerUrl: row?.dexscreener_url ?? env.SITE_DEXSCREENER_URL,
    showDexscreener: row ? row.show_dexscreener === 1 : env.siteShowDexscreener,
    pumpFunUrl: row?.pump_fun_url ?? env.PUMP_FUN_URL,
    tokenAddress: row?.token_address ?? "",
  };
}

export async function saveSiteSettings(settings: SiteSettings): Promise<SiteSettings> {
  await pool.query(
    `INSERT INTO site_settings (
      id,
      twitter_url,
      show_twitter,
      youtube_url,
      show_youtube,
      youtube_live_channel_id,
      telegram_url,
      show_telegram,
      dexscreener_url,
      show_dexscreener,
      pump_fun_url,
      token_address,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
    ON CONFLICT(id) DO UPDATE SET
      twitter_url = excluded.twitter_url,
      show_twitter = excluded.show_twitter,
      youtube_url = excluded.youtube_url,
      show_youtube = excluded.show_youtube,
      youtube_live_channel_id = excluded.youtube_live_channel_id,
      telegram_url = excluded.telegram_url,
      show_telegram = excluded.show_telegram,
      dexscreener_url = excluded.dexscreener_url,
      show_dexscreener = excluded.show_dexscreener,
      pump_fun_url = excluded.pump_fun_url,
      token_address = excluded.token_address,
      updated_at = now()`,
    [
      1,
      settings.twitterUrl || null,
      settings.showTwitter ? 1 : 0,
      settings.youtubeUrl || null,
      settings.showYoutube ? 1 : 0,
      settings.youtubeLiveChannelId.trim() || null,
      settings.telegramUrl || null,
      settings.showTelegram ? 1 : 0,
      settings.dexscreenerUrl || null,
      settings.showDexscreener ? 1 : 0,
      settings.pumpFunUrl || null,
      settings.tokenAddress || null,
    ]
  );

  return getSiteSettings();
}
