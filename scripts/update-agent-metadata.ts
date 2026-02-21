/**
 * Backward-compatible wrapper.
 *
 * Kept for existing commands and docs:
 *   npx tsx scripts/update-agent-metadata.ts
 *
 * Delegates to the canonical sync script in "normalize" mode.
 */

import { runAgentSync } from "./sync-agents.js";

async function main(): Promise<void> {
  const passthrough = process.argv.slice(2);
  await runAgentSync(["--mode", "normalize", ...passthrough]);
}

main().catch((error) => {
  console.error("Metadata normalization failed:", error);
  process.exit(1);
});
