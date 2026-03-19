import crypto from "node:crypto";

export const createId = () => crypto.randomUUID();

export const hashToken = (token: string) =>
  crypto.createHash("sha256").update(token).digest("hex");

export const randomToken = (size = 48) => crypto.randomBytes(size).toString("base64url");
