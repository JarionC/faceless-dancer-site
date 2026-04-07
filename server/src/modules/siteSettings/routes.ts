import { Router } from "express";
import { siteSettingsSchema } from "@faceless/shared";
import { PublicKey } from "@solana/web3.js";
import { getSiteSettings, saveSiteSettings } from "./service.js";
import { requireAuth, requireAdmin } from "../../middleware/auth.js";

const router = Router();

router.get("/", async (req, res) => {
  return res.json(await getSiteSettings());
});

router.get("/admin", requireAuth, requireAdmin, async (req, res) => {
  return res.json(await getSiteSettings());
});

router.put("/admin", requireAuth, requireAdmin, async (req, res) => {
  const parsed = siteSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  if (parsed.data.tokenAddress) {
    try {
      new PublicKey(parsed.data.tokenAddress);
    } catch {
      return res.status(400).json({ error: "Invalid token address" });
    }
  }

  return res.json(await saveSiteSettings(parsed.data));
});

export const siteSettingsRouter = router;
