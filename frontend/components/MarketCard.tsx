"use client";

import { formatEther } from "viem";
import type { Market, MarketStatus } from "@/lib/types";
import { getMarketStatus, formatRelativeDeadline, deadlineDelta } from "@/lib/types";
import StatusBadge from "./StatusBadge";

const borderColor: Record<MarketStatus, string> = {
  open: "border-l-emerald-500",
  awaiting_resolution: "border-l-amber-500",
  resolved: "border-l-blue-500",
};

/** Deadline progress bar for open markets (100% = just created, 0% = about to expire) */
function DeadlineProgress({ market }: { market: Market }) {
  const delta = deadlineDelta(market);
  if (delta <= 0) return null;

  // Estimate original duration from deadline - we cap the bar at 30 days
  const maxDuration = 30 * 86400;
  const pct = Math.min(100, Math.max(2, (delta / maxDuration) * 100));

  return (
    <div className="mt-3">
      <div className="h-1 w-full rounded-full bg-navy-700">
        <div
          className="h-1 rounded-full bg-emerald-500/60 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function MarketCard({ market }: { market: Market }) {
  const status = getMarketStatus(market);
  const relTime = formatRelativeDeadline(market);
  const deadlineDate = new Date(Number(market.deadline) * 1000);
  const rewardStr = formatEther(market.rewardPool);

  return (
    <div
      className={`rounded-xl border border-l-4 border-navy-700 bg-navy-800/50 p-5 transition-colors hover:bg-navy-800/70 ${borderColor[status]}`}
    >
      {/* Header: question + badge */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <h3 className="text-sm font-medium leading-snug text-white">
          {market.question}
        </h3>
        <StatusBadge status={status} />
      </div>

      {/* Stats row */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs">
        {/* Reward — prominent */}
        <span className="flex items-center gap-1.5 text-slate-300">
          <svg className="h-3.5 w-3.5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
          </svg>
          <span className="font-medium">{rewardStr} ETH</span>
        </span>

        {/* Workers */}
        <span className="flex items-center gap-1.5 text-slate-400">
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4-4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
          </svg>
          {market.workers.length} workers
        </span>

        {/* Relative time */}
        <span
          className={`flex items-center gap-1.5 ${
            status === "open"
              ? "text-emerald-400"
              : status === "awaiting_resolution"
                ? "text-amber-400"
                : "text-slate-500"
          }`}
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          {status === "resolved" ? (
            <span>Resolved</span>
          ) : (
            <span>{relTime}</span>
          )}
        </span>

        {/* Market ID + etherscan */}
        <a
          href={`https://sepolia.etherscan.io/address/${market.creator}`}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto font-mono text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
          title={`Market #${market.id} · Creator: ${market.creator}`}
        >
          #{market.id} &middot; {market.creator.slice(0, 6)}...{market.creator.slice(-4)}
        </a>
      </div>

      {/* Context line per status */}
      {status === "awaiting_resolution" && (
        <p className="mt-3 text-[11px] text-amber-400/70">
          Deadline passed &mdash; market can be resolved via CRE workflow. No new workers can join.
        </p>
      )}
      {status === "resolved" && (
        <p className="mt-3 text-[11px] text-blue-400/70">
          Market resolved &mdash; rewards distributed and reputation updated.
        </p>
      )}

      {/* Progress bar for open markets */}
      {status === "open" && <DeadlineProgress market={market} />}

      {/* Absolute deadline on hover-visible row */}
      <div className="mt-2 text-[10px] text-slate-600">
        Deadline: {deadlineDate.toLocaleString()}
      </div>
    </div>
  );
}
