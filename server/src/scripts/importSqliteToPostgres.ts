import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { pool } from "../db/postgres.js";

const TABLES_IN_ORDER = [
  "users",
  "nonces",
  "refresh_tokens",
  "submissions",
  "assets",
  "schedule_slots",
  "site_settings",
  "game_songs",
  "game_scores",
  "game_control_defaults",
  "migrations",
] as const;

function resolveSourcePath(): string {
  const explicit = process.env.SQLITE_IMPORT_PATH?.trim();
  if (explicit) {
    return path.resolve(process.cwd(), explicit);
  }

  const backupsDir = path.resolve(process.cwd(), "..", "docs", "prod-backups");
  const candidates = fs
    .readdirSync(backupsDir)
    .filter((name) => name.endsWith(".db"))
    .map((name) => path.join(backupsDir, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  if (candidates.length === 0) {
    throw new Error(`No .db files found in ${backupsDir}`);
  }

  return candidates[0];
}

function toInsertSql(table: string, columns: string[]): string {
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
  return `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`;
}

async function main() {
  const sourcePath = resolveSourcePath();
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`SQLite source file not found: ${sourcePath}`);
  }

  console.log(`Using SQLite source: ${sourcePath}`);
  const sqlite = new Database(sourcePath, { readonly: true });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      TRUNCATE TABLE
        game_scores,
        game_songs,
        assets,
        schedule_slots,
        submissions,
        refresh_tokens,
        nonces,
        users,
        site_settings,
        game_control_defaults,
        migrations
      RESTART IDENTITY CASCADE
    `);

    for (const table of TABLES_IN_ORDER) {
      const rows = sqlite.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>;
      if (rows.length === 0) {
        console.log(`Imported ${table}: 0`);
        continue;
      }

      const columns = Object.keys(rows[0]);
      const insertSql = toInsertSql(table, columns);

      for (const row of rows) {
        const values = columns.map((column) => row[column]);
        await client.query(insertSql, values);
      }

      console.log(`Imported ${table}: ${rows.length}`);
    }

    await client.query("COMMIT");
    console.log("SQLite -> Postgres import complete.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    sqlite.close();
    await pool.end();
  }
}

await main();

