import { Hono } from "hono";
import type { AgentBindings } from "./config.js";
import { healthRoutes } from "./routes/health.js";
import { a2aRoutes } from "./routes/a2a.js";

export const app = new Hono<{ Bindings: AgentBindings }>();

app.route("/", healthRoutes);
app.route("/", a2aRoutes);

export default {
  fetch: app.fetch,
};
