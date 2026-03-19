import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import type { SessionPayload } from "@faceless/shared";

export const signAccessToken = (payload: SessionPayload) =>
  jwt.sign(payload, env.ACCESS_TOKEN_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions["expiresIn"],
  });

export const verifyAccessToken = (token: string): SessionPayload =>
  jwt.verify(token, env.ACCESS_TOKEN_SECRET) as SessionPayload;

export const signRefreshToken = (payload: Pick<SessionPayload, "userId" | "publicKey">) =>
  jwt.sign(payload, env.REFRESH_TOKEN_SECRET, {
    expiresIn: `${env.REFRESH_TOKEN_TTL_DAYS}d` as jwt.SignOptions["expiresIn"],
  });

export const verifyRefreshToken = (token: string): { userId: string; publicKey: string } =>
  jwt.verify(token, env.REFRESH_TOKEN_SECRET) as { userId: string; publicKey: string };
