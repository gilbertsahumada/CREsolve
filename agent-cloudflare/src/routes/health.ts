import { Hono } from "hono";
import type { AgentBindings } from "../config.js";
import { getConfig } from "../config.js";

export const healthRoutes = new Hono<{ Bindings: AgentBindings }>();

healthRoutes.get("/health", (c) => {
  const config = getConfig(c.env);
  return c.json({ status: "ok", agent: config.name, mode: config.mode });
});
