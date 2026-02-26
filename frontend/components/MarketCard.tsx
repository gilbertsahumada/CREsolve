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

export default function MarketCard({ market }: { market: Market }) {
  const status = getMarketStatus(market);
  const relTime = formatRelativeDeadline(market);
  const deadlineDate = new Date(Number(market.deadline) * 1000);
  const rewardStr = formatEther(market.rewardPool);

  // Mock probabilities for UI purposes
  const probYes = (market.id * 37 % 80) + 10; // Random-ish between 10 and 90
  const probNo = 100 - probYes;

  return (
    <div
      className={`flex flex-col justify-between rounded-2xl border border-navy-700 bg-navy-800/40 p-5 transition-all hover:bg-navy-800/60 hover:border-navy-600 shadow-sm hover:shadow-md`}
    >
      <div>
        {/* Header: question + badge */}
        <div className="mb-4 flex items-start justify-between gap-4">
          <h3 className="text-base font-semibold leading-snug text-slate-100">
            {market.question}
          </h3>
          <div className="shrink-0">
            <StatusBadge status={status} />
          </div>
        </div>

        {/* Stats row */}
        <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          {/* Reward — prominent */}
          <span className="flex items-center gap-1.5 rounded-md bg-accent/10 px-2 py-1 text-accent font-medium border border-accent/20">
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
            </svg>
            {rewardStr} ETH Pool
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
        </div>

        {/* Prediction Market Actions */}
        {status === "open" && (
          <div className="mb-4 space-y-3">
            {/* Probability Bar */}
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-navy-900">
              <div className="bg-emerald-500 transition-all" style={{ width: `${probYes}%` }} />
              <div className="bg-red-500 transition-all" style={{ width: `${probNo}%` }} />
            </div>
            
            {/* Buttons */}
            <div className="flex gap-3">
              <button className="group relative flex flex-1 items-center justify-between overflow-hidden rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 transition-all hover:bg-emerald-500/20 hover:border-emerald-500/50">
                <span className="font-semibold text-emerald-400">Buy Yes</span>
                <span className="font-mono text-sm text-emerald-400/80">{probYes}%</span>
              </button>
              <button className="group relative flex flex-1 items-center justify-between overflow-hidden rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 transition-all hover:bg-red-500/20 hover:border-red-500/50">
                <span className="font-semibold text-red-400">Buy No</span>
                <span className="font-mono text-sm text-red-400/80">{probNo}%</span>
              </button>
            </div>
          </div>
        )}

        {/* Context line per status */}
        {status === "awaiting_resolution" && (
          <div className="mb-4 rounded-lg bg-amber-500/10 p-3 border border-amber-500/20">
            <p className="text-xs text-amber-400/90">
              Deadline passed &mdash; market can be resolved via CRE workflow. No new workers can join.
            </p>
          </div>
        )}
        {status === "resolved" && (
          <div className="mb-4 rounded-lg bg-blue-500/10 p-3 border border-blue-500/20">
            <p className="text-xs text-blue-400/90">
              Market resolved &mdash; rewards distributed and reputation updated.
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-2 flex items-center justify-between border-t border-navy-700/50 pt-4">
        <div className="text-[11px] text-slate-500">
          Ends: {deadlineDate.toLocaleDateString()} {deadlineDate.toLocaleTimeString()}
        </div>
        <a
          href={`https://sepolia.etherscan.io/address/${market.creator}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[11px] text-slate-500 hover:text-accent transition-colors flex items-center gap-1"
          title={`Market #${market.id} · Creator: ${market.creator}`}
        >
          #{market.id} &middot; {market.creator.slice(0, 6)}...{market.creator.slice(-4)}
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
          </svg>
        </a>
      </div>
    </div>
  );
}
