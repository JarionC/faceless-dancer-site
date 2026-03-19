import { z } from "zod";

export const nonceRequestSchema = z.object({
  publicKey: z.string().min(32),
});

export const verifySignatureSchema = z.object({
  publicKey: z.string().min(32),
  nonce: z.string().min(8),
  message: z.string().min(20),
  signature: z.string().min(32),
});
