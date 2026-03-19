export type SessionRole = "user" | "admin";

export interface SessionPayload {
  userId: string;
  publicKey: string;
  isHolder: boolean;
  isAdmin: boolean;
}
