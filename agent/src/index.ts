import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { config } from "./config.js";
import { healthRoutes } from "./routes/health.js";
import { a2aRoutes } from "./routes/a2a.js";

export const app = new Hono();

app.route("/", healthRoutes);
app.route("/", a2aRoutes);

// Only start server when run directly (not imported for tests)
const isDirectRun =
  process.argv[1]?.endsWith("index.ts") ||
  process.argv[1]?.endsWith("index.js");

if (isDirectRun) {
  console.log(
    `[${config.name}] Starting agent on port ${config.port} (mode: ${config.mode})`,
  );
  serve({ fetch: app.fetch, port: config.port });
}
