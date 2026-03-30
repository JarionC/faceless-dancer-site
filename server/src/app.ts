import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import { authRouter } from "./modules/auth/routes.js";
import { submissionsRouter } from "./modules/submissions/routes.js";
import { adminRouter } from "./modules/admin/routes.js";
import { scheduleRouter } from "./modules/schedule/routes.js";
import { siteSettingsRouter } from "./modules/siteSettings/routes.js";
import { gameRouter } from "./modules/game/routes.js";

export const app = express();

app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: env.BEAT_API_MAX_BODY_BYTES }));
app.use(cookieParser());

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "faceless-dancer-server" });
});

app.use("/api/auth", authRouter);
app.use("/api/submissions", submissionsRouter);
app.use("/api/admin", adminRouter);
app.use("/api/schedule", scheduleRouter);
app.use("/api/site-settings", siteSettingsRouter);
app.use("/api/game", gameRouter);

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err);
  if (res.headersSent) {
    return next(err);
  }

  return res.status(500).json({ error: "Internal server error" });
});
