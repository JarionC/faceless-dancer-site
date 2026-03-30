import { type Response, Router } from "express";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { nonceRequestSchema, verifySignatureSchema } from "@faceless/shared";
import { db } from "../../db/sqlite.js";
import { env } from "../../config/env.js";
import { createId, hashToken, randomToken } from "../../utils/crypto.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "./tokens.js";
import { checkHolderEligibility } from "../holders/holderService.js";
import { requireAuth } from "../../middleware/auth.js";

const router = Router();

const setAuthCookies = (res: Response, accessToken: string, refreshToken: string) => {
  const cookieBase = {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: "lax" as const,
    path: "/",
  };

  res.cookie("accessToken", accessToken, {
    ...cookieBase,
    maxAge: 24 * 60 * 60 * 1000,
  });

  res.cookie("refreshToken", refreshToken, {
    ...cookieBase,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
};

const clearAuthCookies = (res: Response) => {
  res.clearCookie("accessToken", { path: "/" });
  res.clearCookie("refreshToken", { path: "/" });
};

router.post("/nonce", (req, res) => {
  const parsed = nonceRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const { publicKey } = parsed.data;
  const nonce = randomToken(18);
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + env.NONCE_TTL_SECONDS * 1000);

  const message = [
    env.AUTH_MESSAGE_PREFIX,
    `Public Key: ${publicKey}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt.toISOString()}`,
  ].join("\n");

  db.prepare(
    `INSERT INTO nonces (id, public_key, nonce, message, expires_at) VALUES (?, ?, ?, ?, ?)`
  ).run(createId(), publicKey, nonce, message, expiresAt.toISOString());

  return res.json({ nonce, message, expiresAt: expiresAt.toISOString() });
});

router.post("/verify", async (req, res) => {
  const parsed = verifySignatureSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const { publicKey, nonce, message, signature } = parsed.data;

  const nonceRow = db
    .prepare(
      `SELECT id, message, expires_at, used_at FROM nonces WHERE public_key = ? AND nonce = ? ORDER BY rowid DESC LIMIT 1`
    )
    .get(publicKey, nonce) as
    | { id: string; message: string; expires_at: string; used_at: string | null }
    | undefined;

  if (!nonceRow) {
    return res.status(400).json({ error: "Nonce not found" });
  }

  if (nonceRow.used_at) {
    return res.status(400).json({ error: "Nonce already used" });
  }

  if (new Date(nonceRow.expires_at).getTime() < Date.now()) {
    return res.status(400).json({ error: "Nonce expired" });
  }

  if (nonceRow.message !== message) {
    return res.status(400).json({ error: "Message mismatch" });
  }

  let validSignature = false;
  try {
    validSignature = nacl.sign.detached.verify(
      Buffer.from(message, "utf8"),
      bs58.decode(signature),
      bs58.decode(publicKey)
    );
  } catch {
    return res.status(400).json({ error: "Invalid public key or signature format" });
  }

  if (!validSignature) {
    return res.status(401).json({ error: "Signature verification failed" });
  }

  let isHolder = false;
  try {
    isHolder = await checkHolderEligibility(publicKey);
  } catch (error) {
    console.error("Holder eligibility check failed", error);
    isHolder = false;
  }
  const isAdmin = env.adminWallets.includes(publicKey);

  const existingUser = db
    .prepare(`SELECT id FROM users WHERE public_key = ? LIMIT 1`)
    .get(publicKey) as { id: string } | undefined;

  const userId = existingUser?.id ?? createId();
  if (!existingUser) {
    db.prepare(`INSERT INTO users (id, public_key, is_admin, is_holder) VALUES (?, ?, ?, ?)`)
      .run(userId, publicKey, isAdmin ? 1 : 0, isHolder ? 1 : 0);
  } else {
    db.prepare(`UPDATE users SET is_admin = ?, is_holder = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(isAdmin ? 1 : 0, isHolder ? 1 : 0, userId);
  }

  db.prepare(`UPDATE nonces SET used_at = datetime('now') WHERE id = ?`).run(nonceRow.id);

  const sessionPayload = { userId, publicKey, isHolder, isAdmin };
  const accessToken = signAccessToken(sessionPayload);
  const refreshToken = signRefreshToken({ userId, publicKey });

  const refreshHash = hashToken(refreshToken);
  const refreshExpiry = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)`)
    .run(createId(), userId, refreshHash, refreshExpiry);

  setAuthCookies(res, accessToken, refreshToken);
  return res.json({ authenticated: true, isHolder, isAdmin, publicKey });
});

router.post("/refresh", (req, res) => {
  const token = req.cookies?.refreshToken as string | undefined;
  if (!token) {
    return res.status(401).json({ error: "Missing refresh token" });
  }

  let payload: { userId: string; publicKey: string };
  try {
    payload = verifyRefreshToken(token);
  } catch {
    return res.status(401).json({ error: "Invalid refresh token" });
  }

  const tokenHash = hashToken(token);
  const row = db
    .prepare(`SELECT id, expires_at, revoked_at FROM refresh_tokens WHERE user_id = ? AND token_hash = ? LIMIT 1`)
    .get(payload.userId, tokenHash) as
    | { id: string; expires_at: string; revoked_at: string | null }
    | undefined;

  if (!row || row.revoked_at || new Date(row.expires_at).getTime() < Date.now()) {
    return res.status(401).json({ error: "Refresh token revoked or expired" });
  }

  const user = db
    .prepare(`SELECT public_key, is_admin, is_holder FROM users WHERE id = ? LIMIT 1`)
    .get(payload.userId) as
    | { public_key: string; is_admin: number; is_holder: number }
    | undefined;

  if (!user) {
    return res.status(401).json({ error: "User missing" });
  }

  db.prepare(`UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE id = ?`).run(row.id);

  const sessionPayload = {
    userId: payload.userId,
    publicKey: user.public_key,
    isAdmin: user.is_admin === 1,
    isHolder: user.is_holder === 1,
  };

  const nextRefresh = signRefreshToken({ userId: payload.userId, publicKey: user.public_key });
  const nextRefreshHash = hashToken(nextRefresh);
  const nextRefreshExpiry = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  db.prepare(`INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)`)
    .run(createId(), payload.userId, nextRefreshHash, nextRefreshExpiry);

  setAuthCookies(res, signAccessToken(sessionPayload), nextRefresh);
  return res.json({ refreshed: true });
});

router.post("/logout", (req, res) => {
  const token = req.cookies?.refreshToken as string | undefined;
  if (token) {
    db.prepare(`UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE token_hash = ?`) 
      .run(hashToken(token));
  }

  clearAuthCookies(res);
  return res.json({ loggedOut: true });
});

router.get("/me", requireAuth, (req, res) => {
  return res.json({
    authenticated: true,
    publicKey: req.session!.publicKey,
    isHolder: req.session!.isHolder,
    isAdmin: req.session!.isAdmin,
  });
});

export const authRouter = router;
