"use client";

import { useMemo, useState } from "react";
import { useMarkets } from "@/lib/hooks";
import { getMarketStatus, sortMarkets, type MarketStatus } from "@/lib/types";
import MarketCard from "./MarketCard";
import CreateMarketModal from "./CreateMarketModal";

type Filter = "all" | MarketStatus;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "awaiting_resolution", label: "Awaiting" },
  { key: "resolved", label: "Resolved" },
];

export default function MarketList() {
  const { markets, loading, error, refresh } = useMarkets();
  const [filter, setFilter] = useState<Filter>("all");
  const [showCreate, setShowCreate] = useState(false);

  const sorted = useMemo(() => sortMarkets(markets), [markets]);

  const filtered = useMemo(
    () =>
      filter === "all"
        ? sorted
        : sorted.filter((m) => getMarketStatus(m) === filter),
    [sorted, filter]
  );

  const counts = useMemo(() => {
    const c = { all: markets.length, open: 0, awaiting_resolution: 0, resolved: 0 };
    for (const m of markets) c[getMarketStatus(m)]++;
    return c;
  }, [markets]);

  return (
    <section>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          Markets
        </h2>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowCreate(true)}
            className="rounded-lg bg-accent/20 px-3 py-1.5 text-xs font-semibold text-accent transition-colors hover:bg-accent/30"
          >
            + Create Market
          </button>
          <button
            onClick={refresh}
            disabled={loading}
            className="text-xs text-accent hover:text-blue-300 transition-colors disabled:opacity-50"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      {markets.length > 0 && (
        <div className="mb-4 flex gap-1.5">
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                filter === key
                  ? "bg-accent/20 text-accent"
                  : "bg-navy-800 text-slate-400 hover:text-slate-200"
              }`}
            >
              {label}
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] leading-none ${
                  filter === key
                    ? "bg-accent/30 text-accent"
                    : "bg-navy-700 text-slate-500"
                }`}
              >
                {counts[key]}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && markets.length === 0 && (
        <div className="rounded-lg border border-navy-700 bg-navy-800/30 p-8 text-center">
          <p className="mb-3 text-sm text-slate-500">No markets found on Sepolia.</p>
          <button
            onClick={() => setShowCreate(true)}
            className="rounded-lg bg-accent/20 px-4 py-2 text-sm font-semibold text-accent transition-colors hover:bg-accent/30"
          >
            Create Your First Market
          </button>
        </div>
      )}

      {/* Filtered empty */}
      {!loading && !error && markets.length > 0 && filtered.length === 0 && (
        <div className="rounded-lg border border-navy-700 bg-navy-800/30 p-6 text-center text-sm text-slate-500">
          No {filter === "awaiting_resolution" ? "awaiting resolution" : filter}{" "}
          markets.
        </div>
      )}

      {/* Market cards */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {filtered.map((market) => (
          <MarketCard key={market.id} market={market} onRefresh={refresh} />
        ))}
      </div>

      {/* Create Market Modal */}
      <CreateMarketModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSuccess={refresh}
      />
    </section>
  );
}
