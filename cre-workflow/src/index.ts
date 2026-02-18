import type { WorkflowConfig, ResolutionResult } from "./types.js";
import { step1Read } from "./step1-read.js";
import { step2Ask } from "./step2-ask.js";
import { step3Challenge } from "./step3-challenge.js";
import { step4Evaluate } from "./step4-evaluate.js";
import { step5Resolve } from "./step5-resolve.js";
import { step6Write } from "./step6-write.js";

export type { WorkflowConfig, ResolutionResult };
export { step1Read, step2Ask, step3Challenge, step4Evaluate, step5Resolve, step6Write };

export interface WorkflowResult {
  resolution: ResolutionResult;
  txHash: string;
}

export async function runResolutionWorkflow(
  config: WorkflowConfig,
): Promise<WorkflowResult> {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║       CRE Resolution Workflow                   ║");
  console.log(`║       Market #${config.marketId.toString().padEnd(35)}║`);
  console.log("╚══════════════════════════════════════════════════╝\n");

  // Step 1: Read market data and worker info from chain
  const { market, workers } = await step1Read(config);

  // Step 2: Ask all workers for their determinations
  const determinations = await step2Ask(
    workers,
    market.question,
    config.marketId,
    config.resolveTimeout ?? 30000,
  );

  // Step 3: Challenge workers (especially disagreeing ones)
  const challengeResults = await step3Challenge(
    workers,
    determinations,
    config.challengeTimeout ?? 15000,
  );

  // Step 4: Evaluate worker quality based on evidence + challenge responses
  const evaluations = step4Evaluate(determinations, challengeResults);

  // Step 5: Weighted majority vote + compute blinded weights
  const resolution = step5Resolve(determinations, evaluations, workers);

  // Step 6: Submit resolution on-chain
  const txHash = await step6Write(config, resolution);

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log(`║  Resolution: ${resolution.resolution ? "YES ✓" : "NO  ✗"}                                ║`);
  console.log(`║  TX: ${txHash.slice(0, 42)}... ║`);
  console.log("╚══════════════════════════════════════════════════╝\n");

  return { resolution, txHash };
}
