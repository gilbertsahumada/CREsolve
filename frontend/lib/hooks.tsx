"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { createPublicClient, http, type Address } from "viem";
import { CHAIN, CONTRACTS, AGENTS, RPC_URL } from "./config";
import {
  getMarketAbi,
  getMarketWorkersAbi,
  getSummaryAbi,
  getClientsAbi,
  marketCountAbi,
  getPoolAbi,
} from "./contracts";
import type { Market, AgentInfo, Reputation, BettingPool, WorkerInfo } from "./types";

// ─── Shared viem client ──────────────────────────────────────────────────────

const client = createPublicClient({
  chain: CHAIN,
  transport: http(RPC_URL),
});

// ─── Fetch reputation from ERC-8004 ReputationRegistry ──────────────────────

const REPUTATION_TAGS = ["resolution_quality", "source_quality", "analysis_depth"] as const;

async function fetchReputation(agentId: number): Promise<Reputation> {
  // Discover which addresses actually submitted feedback for this agent
  const feedbackClients = (await client.readContract({
    address: CONTRACTS.reputationRegistry,
    abi: getClientsAbi,
    functionName: "getClients",
    args: [BigInt(agentId)],
  })) as Address[];

  if (feedbackClients.length === 0) {
    return { resQuality: 0, srcQuality: 0, analysisDepth: 0, count: 0 };
  }

  const [res, src, depth] = await Promise.all(
    REPUTATION_TAGS.map((tag) =>
      client.readContract({
        address: CONTRACTS.reputationRegistry,
        abi: getSummaryAbi,
        functionName: "getSummary",
        args: [BigInt(agentId), feedbackClients, tag, "cresolver"],
      })
    )
  );

  const val = (r: typeof res) => Number((r as [bigint, bigint, number])[1]);
  const cnt = (r: typeof res) => Number((r as [bigint, bigint, number])[0]);

  return {
    resQuality: val(res),
    srcQuality: val(src),
    analysisDepth: val(depth),
    count: cnt(res),
  };
}

// ─── waitForTx ───────────────────────────────────────────────────────────────

export async function waitForTx(hash: `0x${string}`) {
  return client.waitForTransactionReceipt({ hash, confirmations: 1 });
}

// ─── WalletContext ───────────────────────────────────────────────────────────

interface WalletState {
  address: Address | null;
  isConnecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletState>({
  address: null,
  isConnecting: false,
  connect: async () => {},
  disconnect: () => {},
});

export function WalletProvider({ children }: { children: React.ReactNode }) {
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

  return (
    <WalletContext.Provider value={{ address, isConnecting, connect, disconnect }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  return useContext(WalletContext);
}

// ─── useEthPrice ─────────────────────────────────────────────────────────────

export function useEthPrice() {
  const [price, setPrice] = useState<number | null>(null);

  useEffect(() => {
    async function fetchPrice() {
      try {
        const res = await fetch(
          "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd"
        );
        const data = await res.json();
        if (data?.ethereum?.usd) {
          setPrice(data.ethereum.usd);
        }
      } catch (err) {
        console.error("Failed to fetch ETH price", err);
      }
    }

    fetchPrice();
    const interval = setInterval(fetchPrice, 60000); // Update every minute
    return () => clearInterval(interval);
  }, []);

  return price;
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

          const workerAddrs = workers as Address[];
          const workerInfo: WorkerInfo[] = await Promise.all(
            workerAddrs.map(async (addr) => {
              const agent = AGENTS.find(
                (a) => a.address.toLowerCase() === addr.toLowerCase()
              );
              if (!agent) {
                return {
                  address: addr,
                  reputation: { resQuality: 0, srcQuality: 0, analysisDepth: 0, count: 0 },
                };
              }
              try {
                return { address: addr, reputation: await fetchReputation(agent.agentId) };
              } catch {
                return {
                  address: addr,
                  reputation: { resQuality: 0, srcQuality: 0, analysisDepth: 0, count: 0 },
                };
              }
            })
          );

          results.push({
            id: i,
            question: m.question,
            rewardPool: m.rewardPool,
            deadline: m.deadline,
            creator: m.creator,
            resolved: m.resolved,
            resolution: m.resolution,
            workers: workerAddrs,
            workerInfo,
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
            const reputation = await fetchReputation(agent.agentId);
            return { ...agent, reputation, healthy: null as boolean | null };
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
