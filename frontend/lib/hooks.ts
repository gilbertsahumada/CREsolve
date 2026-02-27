"use client";

import { useCallback, useEffect, useState } from "react";
import { createPublicClient, http, type Address } from "viem";
import { CHAIN, CONTRACTS, AGENTS, RPC_URL } from "./config";
import {
  getMarketAbi,
  getMarketWorkersAbi,
  getReputationAbi,
  marketCountAbi,
  getPoolAbi,
} from "./contracts";
import type { Market, AgentInfo, Reputation, BettingPool } from "./types";

// ─── Shared viem client ──────────────────────────────────────────────────────

const client = createPublicClient({
  chain: CHAIN,
  transport: http(RPC_URL),
});

// ─── useWallet ───────────────────────────────────────────────────────────────

export function useWallet() {
  const [address, setAddress] = useState<Address | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const connect = useCallback(async () => {
    if (typeof window === "undefined" || !window.ethereum) {
      alert("Please install MetaMask or another Web3 wallet.");
      return;
    }

    try {
      setIsConnecting(true);
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });
      
      if (accounts && accounts.length > 0) {
        setAddress(accounts[0] as Address);
        
        // Switch to Sepolia if needed
        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: `0x${CHAIN.id.toString(16)}` }],
          });
        } catch (switchError: any) {
          // This error code indicates that the chain has not been added to MetaMask.
          if (switchError.code === 4902) {
            try {
              await window.ethereum.request({
                method: "wallet_addEthereumChain",
                params: [
                  {
                    chainId: `0x${CHAIN.id.toString(16)}`,
                    chainName: CHAIN.name,
                    rpcUrls: [RPC_URL],
                    nativeCurrency: CHAIN.nativeCurrency,
                    blockExplorerUrls: [CHAIN.blockExplorers?.default.url],
                  },
                ],
              });
            } catch (addError) {
              console.error("Failed to add Sepolia network", addError);
            }
          }
        }
      }
    } catch (error) {
      console.error("Failed to connect wallet", error);
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
  }, []);

  // Listen for account changes
  useEffect(() => {
    if (typeof window !== "undefined" && window.ethereum) {
      const handleAccountsChanged = (accounts: string[]) => {
        if (accounts.length > 0) {
          setAddress(accounts[0] as Address);
        } else {
          setAddress(null);
        }
      };

      window.ethereum.on("accountsChanged", handleAccountsChanged);
      
      // Check if already connected
      window.ethereum.request({ method: "eth_accounts" })
        .then((accounts: any) => {
          if (accounts && accounts.length > 0) {
            setAddress(accounts[0] as Address);
          }
        })
        .catch(console.error);

      return () => {
        window.ethereum.removeListener("accountsChanged", handleAccountsChanged);
      };
    }
  }, []);

  return { address, isConnecting, connect, disconnect };
}

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
            resolution: boolean;
          };

          results.push({
            id: i,
            question: m.question,
            rewardPool: m.rewardPool,
            deadline: m.deadline,
            creator: m.creator,
            resolved: m.resolved,
            resolution: m.resolution,
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

// ─── useBettingPool ─────────────────────────────────────────────────────────

export function useBettingPool(marketId: number) {
  const [pool, setPool] = useState<BettingPool | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (CONTRACTS.binaryMarket === "0x0000000000000000000000000000000000000000") {
      setPool(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const data = await client.readContract({
        address: CONTRACTS.binaryMarket,
        abi: getPoolAbi,
        functionName: "getPool",
        args: [BigInt(marketId)],
      });
      const [yesTotal, noTotal, settled, outcome] = data as [bigint, bigint, boolean, boolean];
      setPool({ yesTotal, noTotal, settled, outcome });
    } catch {
      setPool(null);
    } finally {
      setLoading(false);
    }
  }, [marketId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { pool, loading, refresh };
}
