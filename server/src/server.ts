import { app } from "./app.js";
import { env } from "./config/env.js";
import { runMigrations } from "./db/migrateUtil.js";

runMigrations();

app.listen(env.PORT, () => {
  console.log(`Server listening on port ${env.PORT}`);
});
