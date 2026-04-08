import fs from "node:fs";
import path from "node:path";
import { pool } from "./postgres.js";

function resolveMigrationsDir() {
  const candidates = [
    path.resolve(process.cwd(), "src/db/postgresMigrations"),
    path.resolve(process.cwd(), "dist/db/postgresMigrations"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("Could not locate postgres migrations directory (checked src and dist)");
}

export async function runMigrations() {
  const client = await pool.connect();
  try {
    const migrationsDir = resolveMigrationsDir();

    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Repair sequence drift (common after logical imports that copy explicit ids).
    // Without this, INSERT can reuse an existing id and crash startup.
    const sequenceResult = await client.query<{ seq: string | null }>(
      `SELECT pg_get_serial_sequence('migrations', 'id') AS seq`
    );
    const sequenceName = sequenceResult.rows[0]?.seq ?? null;
    if (sequenceName) {
      await client.query(
        `SELECT setval($1::regclass, COALESCE((SELECT MAX(id) FROM migrations), 0) + 1, false)`,
        [sequenceName]
      );
    }

    const appliedRows = await client.query<{ name: string }>("SELECT name FROM migrations");
    const applied = new Set(appliedRows.rows.map((row: { name: string }) => row.name));

    const files = fs.readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();

    for (const file of files) {
      if (applied.has(file)) {
        continue;
      }

      const fullPath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(fullPath, "utf8");

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`Applied migration: ${file}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    client.release();
  }
}
