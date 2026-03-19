import fs from "node:fs";
import path from "node:path";
import { db } from "./sqlite.js";

function resolveMigrationsDir() {
  const candidates = [
    path.resolve(process.cwd(), "src/db/migrations"),
    path.resolve(process.cwd(), "dist/db/migrations"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("Could not locate migrations directory (checked src and dist)");
}

export function runMigrations() {
  const migrationsDir = resolveMigrationsDir();

  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const appliedRows = db.prepare("SELECT name FROM migrations").all() as Array<{ name: string }>;
  const applied = new Set(appliedRows.map((row) => row.name));

  const files = fs.readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();

  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }

    const fullPath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(fullPath, "utf8");

    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO migrations (name) VALUES (?)").run(file);
      db.exec("COMMIT");
      console.log(`Applied migration: ${file}`);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
