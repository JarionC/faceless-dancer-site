import { z } from "zod";

const optionalUrlSchema = z.union([z.string().url(), z.literal("")]);

export const siteSettingsSchema = z.object({
  twitterUrl: optionalUrlSchema.default(""),
  showTwitter: z.boolean().default(true),
  youtubeUrl: optionalUrlSchema.default(""),
  showYoutube: z.boolean().default(true),
  telegramUrl: optionalUrlSchema.default(""),
  showTelegram: z.boolean().default(true),
  dexscreenerUrl: optionalUrlSchema.default(""),
  showDexscreener: z.boolean().default(true),
  pumpFunUrl: optionalUrlSchema.default(""),
  tokenAddress: z.union([z.string().min(32), z.literal("")]).default(""),
});
