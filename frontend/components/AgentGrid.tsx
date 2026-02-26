"use client";

import { useReputation } from "@/lib/hooks";
import AgentCard from "./AgentCard";
import QuorumIndicator from "./QuorumIndicator";

export default function AgentGrid() {
  const { agents, loading } = useReputation();

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          Worker Agents
        </h2>
        <QuorumIndicator total={agents.length || 3} />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-48 animate-pulse rounded-xl border border-navy-700 bg-navy-800/30"
            />
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
