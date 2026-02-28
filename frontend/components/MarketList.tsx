"use client";

import { useMemo, useState } from "react";
import { useMarkets } from "@/lib/hooks";
import { getMarketStatus, sortMarkets, type MarketStatus } from "@/lib/types";
import MarketCard from "./MarketCard";
import CreateMarketModal from "./CreateMarketModal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Pagination } from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";

type Filter = "all" | MarketStatus;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "awaiting_resolution", label: "Awaiting" },
  { key: "resolved", label: "Resolved" },
];

const ITEMS_PER_PAGE = 6;

export default function MarketList() {
  const { markets, loading, error, refresh } = useMarkets();
  const [filter, setFilter] = useState<Filter>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => sortMarkets(markets), [markets]);

  const filtered = useMemo(
    () =>
      filter === "all"
        ? sorted
        : sorted.filter((m) => getMarketStatus(m) === filter),
    [sorted, filter]
  );

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  const paginated = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  const counts = useMemo(() => {
    const c = { all: markets.length, open: 0, awaiting_resolution: 0, resolved: 0 };
    for (const m of markets) c[getMarketStatus(m)]++;
    return c;
  }, [markets]);

  function handleFilterChange(value: string) {
    setFilter(value as Filter);
    setPage(1);
  }

  return (
    <section>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
          Markets
        </h2>
        <div className="flex items-center gap-3">
          <Button variant="accent" size="sm" onClick={() => setShowCreate(true)}>
            + Create Market
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={refresh}
            disabled={loading}
          >
            {loading ? "Loading..." : "Refresh"}
          </Button>
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-72 border border-navy-700" />
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
          <p className="mb-3 text-sm text-slate-400">No markets found on Sepolia.</p>
          <Button variant="accent" onClick={() => setShowCreate(true)}>
            Create Your First Market
          </Button>
        </div>
      )}

      {/* Filter tabs + content */}
      {!loading && markets.length > 0 && (
        <Tabs value={filter} onValueChange={handleFilterChange}>
          <TabsList>
            {FILTERS.map(({ key, label }) => (
              <TabsTrigger key={key} value={key}>
                {label}
                <Badge
                  variant={filter === key ? "accent" : "default"}
                  className="ml-1 px-1.5 py-0 text-[10px] leading-tight"
                >
                  {counts[key]}
                </Badge>
              </TabsTrigger>
            ))}
          </TabsList>

          {/* All tab contents share the same rendering, so we use a single content block */}
          {FILTERS.map(({ key }) => (
            <TabsContent key={key} value={key}>
              {filtered.length === 0 ? (
                <div className="rounded-lg border border-navy-700 bg-navy-800/30 p-6 text-center text-sm text-slate-400">
                  No {key === "awaiting_resolution" ? "awaiting resolution" : key}{" "}
                  markets.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {paginated.map((market) => (
                      <MarketCard key={market.id} market={market} onRefresh={refresh} />
                    ))}
                  </div>
                  <Pagination
                    currentPage={page}
                    totalPages={totalPages}
                    onPageChange={setPage}
                    className="mt-6"
                  />
                </>
              )}
            </TabsContent>
          ))}
        </Tabs>
      )}

      {/* Create Market Modal */}
      <CreateMarketModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSuccess={refresh}
      />
    </section>
  );
}
