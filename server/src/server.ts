import { app } from "./app.js";
import { env } from "./config/env.js";
import { runMigrations } from "./db/postgresMigrateUtil.js";

if (env.runMigrationsOnStart) {
  await runMigrations();
} else {
  console.log("Startup migrations disabled (RUN_MIGRATIONS_ON_START=false).");
}

app.listen(env.PORT, () => {
  console.log(`Server listening on port ${env.PORT}`);
});
