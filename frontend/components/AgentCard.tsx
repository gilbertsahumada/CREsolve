import type { AgentInfo } from "@/lib/types";
import { trust8004Url, etherscanAddress } from "@/lib/config";

function ReputationBar({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px]">
        <span className="text-slate-400">{label}</span>
        <span className="text-slate-300">{value}</span>
      </div>
      <div className="rep-bar">
        <div
          className="rep-bar-fill"
          style={{ width: `${value}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

export default function AgentCard({ agent }: { agent: AgentInfo }) {
  return (
    <div className="rounded-xl border border-navy-700 bg-navy-800/50 p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/20 text-xs font-bold text-accent">
            {agent.name[0]}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">{agent.name}</h3>
            <a
              href={etherscanAddress(agent.address)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
            >
              {agent.address.slice(0, 6)}...{agent.address.slice(-4)}
            </a>
          </div>
        </div>
        <span
          className={`h-2.5 w-2.5 rounded-full ${
            agent.healthy === true
              ? "bg-emerald-400"
              : agent.healthy === false
                ? "bg-red-400"
                : "bg-slate-500"
          }`}
          title={
            agent.healthy === true
              ? "Healthy"
              : agent.healthy === false
                ? "Unreachable"
                : "Unknown"
          }
        />
      </div>

      <div className="mb-3 flex items-center gap-2 text-xs text-slate-400">
        <span>
          Agent ID: <span className="text-slate-300">{agent.agentId}</span>
        </span>
        {agent.reputation.count > 0 && (
          <>
            <span>&middot;</span>
            <span>
              Resolutions:{" "}
              <span className="text-slate-300">{agent.reputation.count}</span>
            </span>
          </>
        )}
        <span>&middot;</span>
        <a
          href={trust8004Url(agent.agentId)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-full border border-accent/20 bg-accent/5 px-2 py-0.5 text-accent hover:bg-accent/10 transition-colors"
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          ERC-8004 Verified
        </a>
      </div>

      <div className="space-y-2">
        <ReputationBar
          label="Resolution Quality"
          value={agent.reputation.resQuality}
          color="#3b82f6"
        />
        <ReputationBar
          label="Source Quality"
          value={agent.reputation.srcQuality}
          color="#8b5cf6"
        />
        <ReputationBar
          label="Analysis Depth"
          value={agent.reputation.analysisDepth}
          color="#06b6d4"
        />
      </div>
    </div>
  );
}
