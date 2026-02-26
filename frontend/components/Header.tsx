import { CHAIN } from "@/lib/config";

export default function Header() {
  return (
    <header className="border-b border-navy-700 bg-navy-800/50 backdrop-blur-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent font-bold text-white">
            CR
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">CREsolver</h1>
            <p className="text-xs text-slate-400">
              ERC-8004 Verifiable Agents + Chainlink CRE
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <a
            href="https://eips.ethereum.org/EIPS/eip-8004"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-medium text-accent hover:bg-accent/20 transition-colors"
          >
            ERC-8004
          </a>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 pulse-dot" />
            {CHAIN.name}
          </span>
          <a
            href="https://github.com/chaoschain/cresolver"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-slate-400 hover:text-white transition-colors"
          >
            GitHub
          </a>
        </div>
      </div>
    </header>
  );
}
