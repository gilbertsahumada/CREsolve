import { Hono } from "hono";
import {
  challengeRequestSchema,
  resolveRequestSchema,
} from "../validation.js";
import type { AgentBindings } from "../config.js";
import { getConfig } from "../config.js";
import { investigate } from "../services/investigator.js";
import { defend } from "../services/defender.js";

export const a2aRoutes = new Hono<{ Bindings: AgentBindings }>();

a2aRoutes.post("/a2a/resolve", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = resolveRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      400,
    );
  }

  try {
    const config = getConfig(c.env);
    const result = await investigate(
      parsed.data.question,
      parsed.data.market_id,
      config,
    );
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Investigation failed";
    return c.json({ error: message }, 500);
  }
});

a2aRoutes.post("/a2a/challenge", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = challengeRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      400,
    );
  }

  try {
    const config = getConfig(c.env);
    const responses = await defend(parsed.data.challenges, config);
    return c.json({ responses });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Defense failed";
    return c.json({ error: message }, 500);
  }
});
