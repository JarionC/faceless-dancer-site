import http from "node:http";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { runMigrations } from "./db/postgresMigrateUtil.js";
import { createDanceOffSocketServer } from "./modules/danceOff/socket.js";

if (env.runMigrationsOnStart) {
  await runMigrations();
} else {
  console.log("Startup migrations disabled (RUN_MIGRATIONS_ON_START=false).");
}

const httpServer = http.createServer(app);
await createDanceOffSocketServer(httpServer);

httpServer.listen(env.PORT, () => {
  console.log(`Server listening on port ${env.PORT}`);
});
