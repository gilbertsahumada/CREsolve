"use client";

import { useCallback, useEffect, useState } from "react";
import { createPublicClient, http, type Address } from "viem";
import { CHAIN, CONTRACTS, AGENTS, RPC_URL } from "./config";
import {
  getMarketAbi,
  getMarketWorkersAbi,
  getReputationAbi,
  marketCountAbi,
} from "./contracts";
import type { Market, AgentInfo, Reputation } from "./types";

// ─── Shared viem client ──────────────────────────────────────────────────────

const client = createPublicClient({
  chain: CHAIN,
  transport: http(RPC_URL),
});

// ─── useMarkets ──────────────────────────────────────────────────────────────

export function useMarkets() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const count = await client.readContract({
        address: CONTRACTS.market,
        abi: marketCountAbi,
        functionName: "marketCount",
      });

      const total = Number(count);
      if (total === 0) {
        setMarkets([]);
        return;
      }

      const results: Market[] = [];

      for (let i = 0; i < total; i++) {
        try {
          const [marketData, workers] = await Promise.all([
            client.readContract({
              address: CONTRACTS.market,
              abi: getMarketAbi,
              functionName: "getMarket",
              args: [BigInt(i)],
            }),
            client.readContract({
              address: CONTRACTS.market,
              abi: getMarketWorkersAbi,
              functionName: "getMarketWorkers",
              args: [BigInt(i)],
            }),
          ]);

          const m = marketData as {
            question: string;
            rewardPool: bigint;
            deadline: bigint;
            creator: Address;
            resolved: boolean;
          };

          results.push({
            id: i,
            question: m.question,
            rewardPool: m.rewardPool,
            deadline: m.deadline,
            creator: m.creator,
            resolved: m.resolved,
            workers: workers as Address[],
          });
        } catch {
          // Skip markets that revert (e.g. deleted)
        }
      }

      setMarkets(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch markets");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { markets, loading, error, refresh };
}

// ─── useReputation ───────────────────────────────────────────────────────────

export function useReputation() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);

      const results = await Promise.all(
        AGENTS.map(async (agent) => {
          try {
            const rep = (await client.readContract({
              address: CONTRACTS.market,
              abi: getReputationAbi,
              functionName: "getReputation",
              args: [agent.address],
            })) as [bigint, bigint, bigint, bigint];

            const reputation: Reputation = {
              resQuality: Number(rep[0]),
              srcQuality: Number(rep[1]),
              analysisDepth: Number(rep[2]),
              count: Number(rep[3]),
            };

            return {
              ...agent,
              reputation,
              healthy: null as boolean | null,
            };
          } catch {
            return {
              ...agent,
              reputation: { resQuality: 0, srcQuality: 0, analysisDepth: 0, count: 0 },
              healthy: null as boolean | null,
            };
          }
        })
      );

      setAgents(results);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { agents, loading, refresh };
}
