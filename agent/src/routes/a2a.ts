import { Hono } from "hono";
import {
  resolveRequestSchema,
  challengeRequestSchema,
} from "../validation.js";
import { investigate } from "../services/investigator.js";
import { defend } from "../services/defender.js";

export const a2aRoutes = new Hono();

a2aRoutes.post("/a2a/resolve", async (c) => {
  const body = await c.req.json();
  const parsed = resolveRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      400,
    );
  }

  try {
    const result = await investigate(parsed.data.question, parsed.data.market_id);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Investigation failed";
    return c.json({ error: message }, 500);
  }
});

a2aRoutes.post("/a2a/challenge", async (c) => {
  const body = await c.req.json();
  const parsed = challengeRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      400,
    );
  }

  try {
    const responses = await defend(parsed.data.challenges);
    return c.json({ responses });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Defense failed";
    return c.json({ error: message }, 500);
  }
});
