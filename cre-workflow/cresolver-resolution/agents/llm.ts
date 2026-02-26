import {
  ConfidentialHTTPClient,
  json,
  ok,
  type Runtime,
} from "@chainlink/cre-sdk";
import type {
  Config,
  WorkerDetermination,
  ChallengeResult,
  WorkerEvaluation,
  LLMWorkerScores,
} from "../types";

// ConfidentialHTTPClient protects the NVIDIA API key via DON Vault secret
// injection. The key is resolved inside the enclave using template syntax
// ({{.NVIDIA_API_KEY}}) and never appears in code, logs, or node memory.
//
// We intentionally do NOT use encryptOutput because we process the LLM
// response inside this workflow (aggregate 8 dimensions → 3 on-chain scores).
// CRE docs: "Do not decrypt inside the workflow." The raw 8-dimension scores
// are ephemeral — only the aggregated results leave the TEE via on-chain report.
const confidentialClient = new ConfidentialHTTPClient();

// ─── Scoring weights for 8 → 3 aggregation ─────────────────────────────────

function aggregateToOnChain(scores: LLMWorkerScores): {
  resolutionQuality: number;
  sourceQuality: number;
  analysisDepth: number;
} {
  const resolutionQuality = Math.round(
    (scores.resolutionQuality * 20 +
      scores.reasoningClarity * 15 +
      scores.evidenceStrength * 10) /
      45,
  );

  const sourceQuality = Math.round(
    (scores.sourceQuality * 15 + scores.timeliness * 10) / 25,
  );

  const analysisDepth = Math.round(
    (scores.analysisDepth * 15 +
      scores.biasAwareness * 10 +
      scores.collaboration * 5) /
      30,
  );

  return { resolutionQuality, sourceQuality, analysisDepth };
}

// ─── Build LLM prompts ─────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are an impartial evaluator for a decentralized prediction market resolution system.

You will receive a market question, and for each worker agent: their determination (YES/NO), confidence level, evidence, sources, challenge questions they received, and their defense responses.

Score each worker on these 8 dimensions (0-100 each):

1. resolutionQuality: Correctness of determination relative to evidence presented, calibration of confidence level
2. sourceQuality: Diversity, reliability, and relevance of cited sources
3. analysisDepth: Thoroughness of evidence, nuance, and detail level
4. reasoningClarity: Structure of arguments, logical flow, coherence
5. evidenceStrength: Factual backing, verifiability of claims made
6. biasAwareness: Acknowledgment of uncertainty, addressing counterarguments
7. timeliness: Recency of sources, use of current data
8. collaboration: Quality of challenge responses, depth of engagement

Return ONLY raw JSON, no markdown fences, no extra text. Use this exact structure:
{
  "workers": [
    {
      "workerAddress": "0x...",
      "resolutionQuality": 0-100,
      "sourceQuality": 0-100,
      "analysisDepth": 0-100,
      "reasoningClarity": 0-100,
      "evidenceStrength": 0-100,
      "biasAwareness": 0-100,
      "timeliness": 0-100,
      "collaboration": 0-100
    }
  ]
}`;
}

function buildUserPrompt(
  question: string,
  determinations: WorkerDetermination[],
  challengeResults: ChallengeResult[],
): string {
  const challengeMap = new Map(
    challengeResults.map((cr) => [cr.workerAddress, cr]),
  );

  const workerSections = determinations.map((det, i) => {
    const cr = challengeMap.get(det.workerAddress);
    const challengeSection =
      cr && cr.challenges.length > 0
        ? cr.challenges
            .map(
              (c, j) =>
                `  Challenge ${j + 1}: ${c}\n  Response ${j + 1}: ${cr.responses[j] ?? "(no response)"}`,
            )
            .join("\n")
        : "  (no challenges)";

    return `--- Worker ${i + 1} ---
Address: ${det.workerAddress}
Determination: ${det.determination ? "YES" : "NO"}
Confidence: ${(det.confidence * 100).toFixed(0)}%
Evidence: ${det.evidence}
Sources: ${det.sources.length > 0 ? det.sources.join(", ") : "(none)"}
Challenges & Responses:
${challengeSection}`;
  });

  return `Market Question: "${question}"

${workerSections.join("\n\n")}

Evaluate each worker on all 8 dimensions. Return JSON only.`;
}

// ─── LLM evaluation ────────────────────────────────────────────────────────

interface LLMResponse {
  workers: LLMWorkerScores[];
}

/** Strip markdown fences that the model may wrap around JSON output. */
function cleanJsonContent(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  return fenced ? fenced[1].trim() : trimmed;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function evaluateWithLLM(
  runtime: Runtime<Config>,
  question: string,
  determinations: WorkerDetermination[],
  challengeResults: ChallengeResult[],
): WorkerEvaluation[] {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(question, determinations, challengeResults);

  const body = JSON.stringify({
    model: "meta/llama-3.3-70b-instruct",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0,
    stream: false,
    max_tokens: 16384,
  });

  runtime.log("Calling NVIDIA/Kimi for LLM evaluation...");

  const response = confidentialClient
    .sendRequest(runtime, {
      vaultDonSecrets: [{ key: "NVIDIA_API_KEY", namespace: "cresolver" }],
      request: {
        url: "https://integrate.api.nvidia.com/v1/chat/completions",
        method: "POST",
        multiHeaders: {
          "Content-Type": { values: ["application/json"] },
          Authorization: { values: ["Bearer {{.NVIDIA_API_KEY}}"] },
        },
        bodyString: body,
        timeout: "60s",
      },
    })
    .result();

  if (!ok(response)) {
    throw new Error(
      `NVIDIA API request failed with status ${response.statusCode}`,
    );
  }

  const data = json(response) as {
    choices: Array<{ message: { content: string } }>;
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("NVIDIA/Kimi returned empty response");
  }

  const cleaned = cleanJsonContent(content);

  let parsed: LLMResponse;
  try {
    parsed = JSON.parse(cleaned) as LLMResponse;
  } catch {
    throw new Error(`Failed to parse LLM JSON response: ${cleaned.slice(0, 200)}`);
  }

  if (!parsed.workers || !Array.isArray(parsed.workers)) {
    throw new Error("LLM response missing 'workers' array");
  }

  // Map LLM scores back to worker evaluations
  const scoreMap = new Map(
    parsed.workers.map((w) => [w.workerAddress.toLowerCase(), w]),
  );

  const evaluations: WorkerEvaluation[] = determinations.map((det) => {
    const scores = scoreMap.get(det.workerAddress.toLowerCase());

    if (!scores) {
      // Fallback: if LLM didn't score this worker, assign neutral scores
      runtime.log(
        `Warning: LLM did not return scores for ${det.workerAddress.slice(0, 10)}..., using defaults`,
      );
      return {
        workerAddress: det.workerAddress,
        qualityScore: 50,
        resolutionQuality: 50,
        sourceQuality: 50,
        analysisDepth: 50,
      };
    }

    // Clamp all raw scores
    const clamped: LLMWorkerScores = {
      workerAddress: det.workerAddress,
      resolutionQuality: clamp(scores.resolutionQuality),
      sourceQuality: clamp(scores.sourceQuality),
      analysisDepth: clamp(scores.analysisDepth),
      reasoningClarity: clamp(scores.reasoningClarity),
      evidenceStrength: clamp(scores.evidenceStrength),
      biasAwareness: clamp(scores.biasAwareness),
      timeliness: clamp(scores.timeliness),
      collaboration: clamp(scores.collaboration),
    };

    // Aggregate 8 → 3 on-chain scores
    const onChain = aggregateToOnChain(clamped);

    // Overall quality score (equal weight of the 3 on-chain scores)
    const qualityScore = Math.round(
      (onChain.resolutionQuality + onChain.sourceQuality + onChain.analysisDepth) / 3,
    );

    runtime.log(
      `${det.workerAddress.slice(0, 10)}...: resQ=${onChain.resolutionQuality} srcQ=${onChain.sourceQuality} depth=${onChain.analysisDepth} (overall=${qualityScore})`,
    );

    return {
      workerAddress: det.workerAddress,
      qualityScore,
      resolutionQuality: onChain.resolutionQuality,
      sourceQuality: onChain.sourceQuality,
      analysisDepth: onChain.analysisDepth,
    };
  });

  runtime.log(`LLM evaluation complete for ${evaluations.length} workers`);
  return evaluations;
}
