import { Pool } from "pg";
import { env } from "../config/env.js";

function normalizeConnectionString(connectionString: string): string {
  try {
    const parsed = new URL(connectionString);
    parsed.searchParams.delete("sslmode");
    parsed.searchParams.delete("ssl");
    return parsed.toString();
  } catch {
    return connectionString;
  }
}

export const pool = new Pool({
  connectionString: normalizeConnectionString(env.DATABASE_URL),
  ssl: env.DATABASE_URL.includes("sslmode=") || env.DATABASE_URL.includes("ssl=")
    ? { rejectUnauthorized: env.databaseSslRejectUnauthorized }
    : undefined,
});

export async function closePool(): Promise<void> {
  await pool.end();
}
