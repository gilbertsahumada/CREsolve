import { Hono } from "hono";
import type { AgentBindings } from "../config.js";
import { getConfig } from "../config.js";

export const healthRoutes = new Hono<{ Bindings: AgentBindings }>();

healthRoutes.get("/health", (c) => {
  const config = getConfig(c.env);
  return c.json({ status: "ok", agent: config.name, mode: config.mode });
});

healthRoutes.get("/.well-known/agent.json", (c) => {
  const config = getConfig(c.env);
  return c.json({
    name: config.name,
    description: "CREsolver A2A worker agent",
    protocol: "a2a",
    version: "0.1.0",
    services: [
      {
        name: "A2A",
        description: "Prediction market resolution via investigate/challenge protocol",
        endpoints: {
          resolve: "/a2a/resolve",
          challenge: "/a2a/challenge",
        },
      },
    ],
  });
});
