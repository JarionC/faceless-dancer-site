import { runMigrations } from "./postgresMigrateUtil.js";

await runMigrations();
console.log("Postgres migrations complete.");
