import { Hono } from "hono";
import { config } from "../config.js";

export const healthRoutes = new Hono();

healthRoutes.get("/health", (c) =>
  c.json({ status: "ok", agent: config.name, mode: config.mode }),
);
