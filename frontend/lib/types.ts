import type { Address } from "viem";

export interface Market {
  id: number;
  question: string;
  rewardPool: bigint;
  deadline: bigint;
  creator: Address;
  resolved: boolean;
  resolution: boolean;
  workers: Address[];
}

export interface BettingPool {
  yesTotal: bigint;
  noTotal: bigint;
  settled: boolean;
  outcome: boolean;
}

export interface Reputation {
  resQuality: number;
  srcQuality: number;
  analysisDepth: number;
  count: number;
}

export interface AgentInfo {
  name: string;
  address: Address;
  agentId: number;
  reputation: Reputation;
  healthy: boolean | null; // null = unknown
}

export type MarketStatus = "open" | "awaiting_resolution" | "resolved";

export function getMarketStatus(market: Market): MarketStatus {
  if (market.resolved) return "resolved";
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (market.deadline < now) return "awaiting_resolution";
  return "open";
}

/** Seconds remaining until deadline (negative = overdue) */
export function deadlineDelta(market: Market): number {
  const now = Math.floor(Date.now() / 1000);
  return Number(market.deadline) - now;
}

/** Human-readable relative time: "2h 15m left" or "Expired 3m ago" */
export function formatRelativeDeadline(market: Market): string {
  const delta = deadlineDelta(market);
  const abs = Math.abs(delta);

  if (abs < 60) return delta >= 0 ? `${abs}s left` : `Expired ${abs}s ago`;
  if (abs < 3600) {
    const m = Math.floor(abs / 60);
    return delta >= 0 ? `${m}m left` : `Expired ${m}m ago`;
  }
  if (abs < 86400) {
    const h = Math.floor(abs / 3600);
    const m = Math.floor((abs % 3600) / 60);
    const time = m > 0 ? `${h}h ${m}m` : `${h}h`;
    return delta >= 0 ? `${time} left` : `Expired ${time} ago`;
  }
  const d = Math.floor(abs / 86400);
  const h = Math.floor((abs % 86400) / 3600);
  const time = h > 0 ? `${d}d ${h}h` : `${d}d`;
  return delta >= 0 ? `${time} left` : `Expired ${time} ago`;
}

/** Sort markets: open (soonest first) → awaiting (most recent first) → resolved */
export function sortMarkets(markets: Market[]): Market[] {
  const order: Record<MarketStatus, number> = {
    open: 0,
    awaiting_resolution: 1,
    resolved: 2,
  };
  return [...markets].sort((a, b) => {
    const sa = getMarketStatus(a);
    const sb = getMarketStatus(b);
    if (order[sa] !== order[sb]) return order[sa] - order[sb];
    // Within same status: open by deadline asc, others by deadline desc
    if (sa === "open") return Number(a.deadline - b.deadline);
    return Number(b.deadline - a.deadline);
  });
}
