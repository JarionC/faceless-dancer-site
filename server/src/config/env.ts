import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "..", ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "..", ".env.docker") });

const optionalUrlSchema = z.union([z.string().url(), z.literal("")]).default("");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  CLIENT_ORIGIN: z.string().default("http://localhost:5173"),

  DATABASE_PATH: z.string().default("/app/data/faceless-dancer.db"),
  RUN_MIGRATIONS_ON_START: z.enum(["true", "false"]).default("false"),

  AUTH_MESSAGE_PREFIX: z.string().default("Faceless Dancer wallet verification"),
  NONCE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  ACCESS_TOKEN_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().default("24h"),
  REFRESH_TOKEN_SECRET: z.string().min(32),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_SECURE: z.enum(["true", "false"]).default("false"),

  SOLANA_RPC_URL: z.string().url(),
  HOLDER_TOKEN_MINT: z.string().min(32),
  HOLDER_MIN_BALANCE: z.coerce.number().nonnegative().default(1),

  BUNNY_STORAGE_ZONE: z.string().min(1),
  BUNNY_STORAGE_PASSWORD: z.string().min(1),
  BUNNY_STORAGE_REGION: z.string().default(""),
  BUNNY_STORAGE_ENDPOINT: z.string().url().optional(),
  BUNNY_PULL_ZONE_HOSTNAME: z.string().min(1),

  SITE_TWITTER_URL: optionalUrlSchema,
  SITE_SHOW_TWITTER: z.enum(["true", "false"]).default("true"),
  SITE_YOUTUBE_URL: optionalUrlSchema,
  SITE_SHOW_YOUTUBE: z.enum(["true", "false"]).default("true"),
  SITE_YOUTUBE_LIVE_CHANNEL_ID: z.string().default(""),
  SITE_TELEGRAM_URL: optionalUrlSchema,
  SITE_SHOW_TELEGRAM: z.enum(["true", "false"]).default("true"),
  SITE_DEXSCREENER_URL: optionalUrlSchema,
  SITE_SHOW_DEXSCREENER: z.enum(["true", "false"]).default("true"),
  PUMP_FUN_URL: optionalUrlSchema,

  ADMIN_WALLETS: z.string().default(""),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().positive().default(20),
  ALLOWED_IMAGE_MIME: z.string().default("image/png,image/jpeg,image/webp"),
  ALLOWED_AUDIO_MIME: z.string().default("audio/mpeg,audio/wav,audio/x-wav"),

  BEAT_STORAGE_DIR: z.string().default("./server/beat-storage"),
  BEAT_API_MAX_BODY_BYTES: z.coerce.number().int().positive().default(50 * 1024 * 1024),
  BEAT_SEPARATION_WORKER_URL: z.string().url().default("http://separation-worker:8792"),
  BEAT_SEPARATION_LOG_TAIL_LINES: z.coerce.number().int().positive().default(300),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Environment validation failed", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const data = parsed.data;

export const env = {
  ...data,
  cookieSecure: data.COOKIE_SECURE === "true",
  adminWallets: data.ADMIN_WALLETS.split(",").map((value) => value.trim()).filter(Boolean),
  allowedImageMime: data.ALLOWED_IMAGE_MIME.split(",").map((value) => value.trim()),
  allowedAudioMime: data.ALLOWED_AUDIO_MIME.split(",").map((value) => value.trim()),
  maxUploadSizeBytes: data.MAX_UPLOAD_SIZE_MB * 1024 * 1024,
  siteShowTwitter: data.SITE_SHOW_TWITTER === "true",
  siteShowYoutube: data.SITE_SHOW_YOUTUBE === "true",
  siteShowTelegram: data.SITE_SHOW_TELEGRAM === "true",
  siteShowDexscreener: data.SITE_SHOW_DEXSCREENER === "true",
  storageEndpoint:
    data.BUNNY_STORAGE_ENDPOINT ??
    (data.BUNNY_STORAGE_REGION ? `https://${data.BUNNY_STORAGE_REGION}.storage.bunnycdn.com` : "https://storage.bunnycdn.com"),
  beatStorageDir: path.isAbsolute(data.BEAT_STORAGE_DIR)
    ? data.BEAT_STORAGE_DIR
    : path.resolve(process.cwd(), data.BEAT_STORAGE_DIR),
  runMigrationsOnStart: data.RUN_MIGRATIONS_ON_START === "true",
};
