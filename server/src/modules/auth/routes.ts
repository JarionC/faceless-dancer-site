import { type Response, Router } from "express";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { nonceRequestSchema, verifySignatureSchema } from "@faceless/shared";
import { pool } from "../../db/postgres.js";
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

router.post("/nonce", async (req, res) => {
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

  await pool.query(
    `INSERT INTO nonces (id, public_key, nonce, message, expires_at) VALUES ($1, $2, $3, $4, $5)`,
    [createId(), publicKey, nonce, message, expiresAt.toISOString()]
  );

  return res.json({ nonce, message, expiresAt: expiresAt.toISOString() });
});

router.post("/verify", async (req, res) => {
  const parsed = verifySignatureSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const { publicKey, nonce, message, signature } = parsed.data;

  const nonceResult = await pool.query<{
    id: string;
    message: string;
    expires_at: string;
    used_at: string | null;
  }>(
    `SELECT id, message, expires_at, used_at
     FROM nonces
     WHERE public_key = $1 AND nonce = $2
     ORDER BY expires_at DESC
     LIMIT 1`,
    [publicKey, nonce]
  );

  const nonceRow = nonceResult.rows[0];
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

  const existingUserResult = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE public_key = $1 LIMIT 1`,
    [publicKey]
  );

  const existingUser = existingUserResult.rows[0];
  const userId = existingUser?.id ?? createId();
  if (!existingUser) {
    await pool.query(
      `INSERT INTO users (id, public_key, is_admin, is_holder) VALUES ($1, $2, $3, $4)`,
      [userId, publicKey, isAdmin ? 1 : 0, isHolder ? 1 : 0]
    );
  } else {
    await pool.query(
      `UPDATE users SET is_admin = $1, is_holder = $2, updated_at = now() WHERE id = $3`,
      [isAdmin ? 1 : 0, isHolder ? 1 : 0, userId]
    );
  }

  await pool.query(`UPDATE nonces SET used_at = now() WHERE id = $1`, [nonceRow.id]);

  const sessionPayload = { userId, publicKey, isHolder, isAdmin };
  const accessToken = signAccessToken(sessionPayload);
  const refreshToken = signRefreshToken({ userId, publicKey });

  const refreshHash = hashToken(refreshToken);
  const refreshExpiry = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await pool.query(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
    [createId(), userId, refreshHash, refreshExpiry]
  );

  setAuthCookies(res, accessToken, refreshToken);
  return res.json({ authenticated: true, isHolder, isAdmin, publicKey });
});

router.post("/refresh", async (req, res) => {
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
  const refreshResult = await pool.query<{
    id: string;
    expires_at: string;
    revoked_at: string | null;
  }>(
    `SELECT id, expires_at, revoked_at FROM refresh_tokens WHERE user_id = $1 AND token_hash = $2 LIMIT 1`,
    [payload.userId, tokenHash]
  );

  const row = refreshResult.rows[0];
  if (!row || row.revoked_at || new Date(row.expires_at).getTime() < Date.now()) {
    return res.status(401).json({ error: "Refresh token revoked or expired" });
  }

  const userResult = await pool.query<{
    public_key: string;
    is_admin: number;
    is_holder: number;
  }>(
    `SELECT public_key, is_admin, is_holder FROM users WHERE id = $1 LIMIT 1`,
    [payload.userId]
  );

  const user = userResult.rows[0];
  if (!user) {
    return res.status(401).json({ error: "User missing" });
  }

  await pool.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`, [row.id]);

  const sessionPayload = {
    userId: payload.userId,
    publicKey: user.public_key,
    isAdmin: user.is_admin === 1,
    isHolder: user.is_holder === 1,
  };

  const nextRefresh = signRefreshToken({ userId: payload.userId, publicKey: user.public_key });
  const nextRefreshHash = hashToken(nextRefresh);
  const nextRefreshExpiry = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  await pool.query(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
    [createId(), payload.userId, nextRefreshHash, nextRefreshExpiry]
  );

  setAuthCookies(res, signAccessToken(sessionPayload), nextRefresh);
  return res.json({ refreshed: true });
});

router.post("/logout", async (req, res) => {
  const token = req.cookies?.refreshToken as string | undefined;
  if (token) {
    await pool.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1`, [hashToken(token)]);
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
