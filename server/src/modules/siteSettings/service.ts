import type { SiteSettings } from "@faceless/shared/dist/types/siteSettings.js";
import { db } from "../../db/sqlite.js";
import { env } from "../../config/env.js";

interface SiteSettingsRow {
  twitter_url: string | null;
  show_twitter: number;
  youtube_url: string | null;
  show_youtube: number;
  telegram_url: string | null;
  show_telegram: number;
  dexscreener_url: string | null;
  show_dexscreener: number;
  pump_fun_url: string | null;
  token_address: string | null;
}

function readRow() {
  return db
    .prepare(
      `SELECT twitter_url, show_twitter, youtube_url, show_youtube, telegram_url, show_telegram, dexscreener_url, show_dexscreener, pump_fun_url, token_address
       FROM site_settings
       WHERE id = 1
       LIMIT 1`
    )
    .get() as SiteSettingsRow | undefined;
}

export function getSiteSettings(): SiteSettings {
  const row = readRow();

  return {
    twitterUrl: row?.twitter_url ?? env.SITE_TWITTER_URL,
    showTwitter: row ? row.show_twitter === 1 : env.siteShowTwitter,
    youtubeUrl: row?.youtube_url ?? env.SITE_YOUTUBE_URL,
    showYoutube: row ? row.show_youtube === 1 : env.siteShowYoutube,
    telegramUrl: row?.telegram_url ?? env.SITE_TELEGRAM_URL,
    showTelegram: row ? row.show_telegram === 1 : env.siteShowTelegram,
    dexscreenerUrl: row?.dexscreener_url ?? env.SITE_DEXSCREENER_URL,
    showDexscreener: row ? row.show_dexscreener === 1 : env.siteShowDexscreener,
    pumpFunUrl: row?.pump_fun_url ?? env.PUMP_FUN_URL,
    tokenAddress: row ? row.token_address ?? "" : env.HOLDER_TOKEN_MINT,
  };
}

export function saveSiteSettings(settings: SiteSettings) {
  db.prepare(
    `INSERT INTO site_settings (
      id,
      twitter_url,
      show_twitter,
      youtube_url,
      show_youtube,
      telegram_url,
      show_telegram,
      dexscreener_url,
      show_dexscreener,
      pump_fun_url,
      token_address,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      twitter_url = excluded.twitter_url,
      show_twitter = excluded.show_twitter,
      youtube_url = excluded.youtube_url,
      show_youtube = excluded.show_youtube,
      telegram_url = excluded.telegram_url,
      show_telegram = excluded.show_telegram,
      dexscreener_url = excluded.dexscreener_url,
      show_dexscreener = excluded.show_dexscreener,
      pump_fun_url = excluded.pump_fun_url,
      token_address = excluded.token_address,
      updated_at = datetime('now')`
  ).run(
    1,
    settings.twitterUrl || null,
    settings.showTwitter ? 1 : 0,
    settings.youtubeUrl || null,
    settings.showYoutube ? 1 : 0,
    settings.telegramUrl || null,
    settings.showTelegram ? 1 : 0,
    settings.dexscreenerUrl || null,
    settings.showDexscreener ? 1 : 0,
    settings.pumpFunUrl || null,
    settings.tokenAddress || null
  );

  return getSiteSettings();
}
