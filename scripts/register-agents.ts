/**
 * Backward-compatible wrapper.
 *
 * Kept for existing commands and docs:
 *   npx tsx scripts/register-agents.ts
 *
 * Delegates to the canonical sync script in "full" mode.
 */

import { runAgentSync } from "./sync-agents.js";

async function main(): Promise<void> {
  const passthrough = process.argv.slice(2);
  await runAgentSync(["--mode", "full", ...passthrough]);
}

main().catch((error) => {
  console.error("Registration flow failed:", error);
  process.exit(1);
});
