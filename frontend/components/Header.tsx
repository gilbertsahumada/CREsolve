"use client";

import { CHAIN } from "@/lib/config";
import { useWallet } from "@/lib/hooks";

export default function Header() {
  const { address, isConnecting, connect, disconnect } = useWallet();

  return (
    <header className="border-b border-navy-700 bg-navy-800/50 backdrop-blur-sm sticky top-0 z-50">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent font-bold text-white shadow-lg shadow-accent/20">
            CR
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white tracking-tight">CREsolver</h1>
            <p className="text-xs text-slate-400">
              ERC-8004 Verifiable Agents + Chainlink CRE
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <a
            href="https://eips.ethereum.org/EIPS/eip-8004"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-medium text-accent hover:bg-accent/20 transition-colors"
          >
            ERC-8004
          </a>
          <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 pulse-dot" />
            {CHAIN.name}
          </span>
          
          <div className="h-4 w-px bg-navy-600 hidden sm:block"></div>

          {address ? (
            <button
              onClick={disconnect}
              className="inline-flex items-center gap-2 rounded-lg border border-navy-600 bg-navy-800 px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-navy-700 hover:text-white"
              title="Disconnect"
            >
              <div className="h-2 w-2 rounded-full bg-emerald-500"></div>
              {address.slice(0, 6)}...{address.slice(-4)}
            </button>
          ) : (
            <button
              onClick={connect}
              disabled={isConnecting}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-all hover:bg-blue-400 hover:shadow-lg hover:shadow-accent/20 disabled:opacity-70"
            >
              {isConnecting ? "Connecting..." : "Connect Wallet"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
