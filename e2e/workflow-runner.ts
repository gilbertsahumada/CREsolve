/**
 * E2E runner shim.
 * Re-exports the canonical local workflow runner from scripts/ to avoid
 * duplicated orchestration logic across the repository.
 */

export {
  runResolutionWorkflow,
  type WorkflowConfig,
  type WorkflowResult,
} from "../scripts/workflow-runner.js";
