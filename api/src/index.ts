import { serve } from "@hono/node-server";
import { pathToFileURL } from "node:url";
import { app, warmAuth } from "./app.js";
import { pool } from "./db.js";
import { migrate } from "./migrate.js";
import { assertProductionSecrets } from "./secrets.js";

export async function start(port = Number(process.env.PORT || 8080)) {
  assertProductionSecrets();
  await migrate();
  await warmAuth();
  const server = serve({ fetch: app.fetch, hostname: "0.0.0.0", port });
  return server;
}

export async function stop(server: { close: (cb?: () => void) => void }) {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
}

const invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (invoked === import.meta.url) {
  start()
    .then(() => {
      console.log(`common-voice api listening on ${process.env.PORT || 8080}`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
