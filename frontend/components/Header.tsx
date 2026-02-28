"use client";

import { CHAIN } from "@/lib/config";
import { useWallet } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

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
          <Badge variant="accent" className="hidden sm:inline-flex" asChild>
            <a
              href="https://eips.ethereum.org/EIPS/eip-8004"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:bg-accent/20 transition-colors"
            >
              ERC-8004
            </a>
          </Badge>

          <Badge variant="success" className="hidden sm:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 pulse-dot" />
            {CHAIN.name}
          </Badge>

          <Separator orientation="vertical" className="hidden sm:block" />

          {address ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" onClick={disconnect} title="Disconnect">
                  <div className="h-2 w-2 rounded-full bg-emerald-500" />
                  {address.slice(0, 6)}...{address.slice(-4)}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="font-mono">{address}</p>
              </TooltipContent>
            </Tooltip>
          ) : (
            <Button onClick={connect} disabled={isConnecting}>
              {isConnecting ? "Connecting..." : "Connect Wallet"}
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
