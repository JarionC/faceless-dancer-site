import { app } from "./app.js";
import { env } from "./config/env.js";
import { runMigrations } from "./db/migrateUtil.js";

if (env.runMigrationsOnStart) {
  runMigrations();
} else {
  console.log("Startup migrations disabled (RUN_MIGRATIONS_ON_START=false).");
}

app.listen(env.PORT, () => {
  console.log(`Server listening on port ${env.PORT}`);
});
