"use client";

import { useReputation } from "@/lib/hooks";
import AgentCard from "./AgentCard";
import QuorumIndicator from "./QuorumIndicator";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export default function AgentGrid() {
  const { agents, loading } = useReputation();

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
            Worker Agents
          </h2>
          <Badge variant="accent" className="text-[10px] px-2 py-0.5">
            <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            ERC-8004
          </Badge>
        </div>
        <QuorumIndicator total={agents.length || 3} />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-48 border border-navy-700" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {agents.map((agent) => (
            <AgentCard key={agent.address} agent={agent} />
          ))}
        </div>
      )}
    </section>
  );
}
