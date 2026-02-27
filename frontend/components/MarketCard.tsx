"use client";

import { useState } from "react";
import { formatEther, parseEther, encodeFunctionData } from "viem";
import { Minus, Plus, ExternalLink, Loader2, CheckCircle2, XCircle, ChevronDown } from "lucide-react";
import type { Market } from "@/lib/types";
import { getMarketStatus, formatRelativeDeadline } from "@/lib/types";
import { useBettingPool, useWallet, useEthPrice, waitForTx } from "@/lib/hooks";
import { checkAgentOwnership } from "@/lib/blockchain";
import { CONTRACTS, AGENTS, etherscanAddress, trust8004Url } from "@/lib/config";
import { buyYesAbi, buyNoAbi, settleAbi, claimAbi, joinMarketAbi, requestResolutionAbi } from "@/lib/contracts";
import StatusBadge from "./StatusBadge";

type TxState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "confirming"; hash: string }
  | { status: "success"; hash: string }
  | { status: "error"; message: string };

export default function MarketCard({ market, onRefresh }: { market: Market; onRefresh?: () => void }) {
  const status = getMarketStatus(market);
  const deadlineDate = new Date(Number(market.deadline) * 1000);
  const rewardStr = formatEther(market.rewardPool);
  const { address } = useWallet();
  const { pool, refresh: refreshPool } = useBettingPool(market.id);
  const ethPrice = useEthPrice();

  const [showWorkers, setShowWorkers] = useState(false);
  const [usdAmount, setUsdAmount] = useState<number>(10);
  const [txState, setTxState] = useState<TxState>({ status: "idle" });
  const txPending = txState.status === "pending" || txState.status === "confirming";

  // Join Market — separate tx state so it doesn't collide with betting/resolution
  const [showJoin, setShowJoin] = useState(false);
  const [agentIdInput, setAgentIdInput] = useState("");
  const [ownershipStatus, setOwnershipStatus] = useState<"idle" | "checking" | "valid" | "invalid">("idle");
  const [ownershipError, setOwnershipError] = useState("");
  const [joinTxState, setJoinTxState] = useState<TxState>({ status: "idle" });
  const joinTxPending = joinTxState.status === "pending" || joinTxState.status === "confirming";

  // Request Resolution state
  const [resolutionRequested, setResolutionRequested] = useState(false);

  // Calculate ETH equivalent
  const ethAmount = ethPrice ? (usdAmount / ethPrice).toFixed(6) : "0";

  // Calculate probabilities from pool data
  const zero = BigInt(0);
  const hundred = BigInt(100);
  const bps = BigInt(10000);
  const feeBps = BigInt(100);
  const yesTotal = pool?.yesTotal ?? zero;
  const noTotal = pool?.noTotal ?? zero;
  const totalBets = yesTotal + noTotal;
  const probYes = totalBets > zero ? Number((yesTotal * hundred) / totalBets) : 50;
  const probNo = 100 - probYes;

  const binaryMarketDeployed = CONTRACTS.binaryMarket !== "0x0000000000000000000000000000000000000000";

  const marketFull = market.workers.length >= 10;

  async function sendTx(to: `0x${string}`, data: `0x${string}`, value?: bigint, onTxSuccess?: () => void) {
    if (!window.ethereum || !address) {
      alert("Please connect your wallet first.");
      return;
    }
    setTxState({ status: "pending" });
    try {
      const hash = await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [{
          from: address,
          to,
          data,
          ...(value ? { value: `0x${value.toString(16)}` } : {}),
        }],
      }) as string;

      setTxState({ status: "confirming", hash });

      await waitForTx(hash as `0x${string}`);

      setTxState({ status: "success", hash });
      onTxSuccess?.();

      // Auto-dismiss after 6 seconds
      setTimeout(() => setTxState((s) => s.status === "success" ? { status: "idle" } : s), 6000);
    } catch (err: any) {
      if (err.code === 4001) {
        // User rejected — silently reset
        setTxState({ status: "idle" });
      } else {
        const message = err?.message?.slice(0, 120) ?? "Transaction failed";
        setTxState({ status: "error", message });
        setTimeout(() => setTxState((s) => s.status === "error" ? { status: "idle" } : s), 8000);
      }
    }
  }

  function handleBuyYes() {
    if (!ethPrice || Number(ethAmount) <= 0) return;
    const data = encodeFunctionData({ abi: buyYesAbi, functionName: "buyYes", args: [BigInt(market.id)] });
    sendTx(CONTRACTS.binaryMarket, data, parseEther(ethAmount), refreshPool);
  }

  function handleBuyNo() {
    if (!ethPrice || Number(ethAmount) <= 0) return;
    const data = encodeFunctionData({ abi: buyNoAbi, functionName: "buyNo", args: [BigInt(market.id)] });
    sendTx(CONTRACTS.binaryMarket, data, parseEther(ethAmount), refreshPool);
  }

  function handleSettle() {
    const data = encodeFunctionData({ abi: settleAbi, functionName: "settle", args: [BigInt(market.id)] });
    sendTx(CONTRACTS.binaryMarket, data, undefined, refreshPool);
  }

  function handleClaim() {
    const data = encodeFunctionData({ abi: claimAbi, functionName: "claim", args: [BigInt(market.id)] });
    sendTx(CONTRACTS.binaryMarket, data, undefined, refreshPool);
  }

  async function handleVerifyAgent() {
    const id = Number(agentIdInput);
    if (!address || !id || id <= 0) return;
    setOwnershipStatus("checking");
    setOwnershipError("");
    try {
      const isOwner = await checkAgentOwnership(address, id);
      if (isOwner) {
        setOwnershipStatus("valid");
      } else {
        setOwnershipStatus("invalid");
        setOwnershipError("Your wallet is not the owner/approved for this agent ID.");
      }
    } catch {
      setOwnershipStatus("invalid");
      setOwnershipError("Failed to verify — check your connection and try again.");
    }
  }

  async function handleJoinMarket() {
    const id = Number(agentIdInput);
    if (!id || ownershipStatus !== "valid") return;
    if (!window.ethereum || !address) return;

    const data = encodeFunctionData({
      abi: joinMarketAbi,
      functionName: "joinMarket",
      args: [BigInt(market.id), BigInt(id)],
    });
    const value = parseEther("0.0001");

    setJoinTxState({ status: "pending" });
    try {
      const hash = await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [{ from: address, to: CONTRACTS.market, data, value: `0x${value.toString(16)}` }],
      }) as string;

      setJoinTxState({ status: "confirming", hash });
      await waitForTx(hash as `0x${string}`);
      setJoinTxState({ status: "success", hash });

      setShowJoin(false);
      setAgentIdInput("");
      setOwnershipStatus("idle");
      onRefresh?.();

      setTimeout(() => setJoinTxState((s) => s.status === "success" ? { status: "idle" } : s), 6000);
    } catch (err: any) {
      if (err.code === 4001) {
        setJoinTxState({ status: "idle" });
      } else {
        const message = err?.message?.slice(0, 120) ?? "Transaction failed";
        setJoinTxState({ status: "error", message });
        setTimeout(() => setJoinTxState((s) => s.status === "error" ? { status: "idle" } : s), 8000);
      }
    }
  }

  function handleRequestResolution() {
    const data = encodeFunctionData({
      abi: requestResolutionAbi,
      functionName: "requestResolution",
      args: [BigInt(market.id)],
    });
    sendTx(CONTRACTS.market, data, undefined, () => {
      setResolutionRequested(true);
    });
  }

  return (
    <div
      className="flex flex-col justify-between rounded-2xl border border-navy-700 bg-navy-800/40 p-5 transition-all hover:bg-navy-800/60 hover:border-navy-600 shadow-sm hover:shadow-md"
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
          <span className="flex items-center gap-1.5 rounded-md bg-accent/10 px-2 py-1 text-accent font-medium border border-accent/20">
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
            </svg>
            {rewardStr} ETH Pool
          </span>

          <button
            onClick={() => setShowWorkers((v) => !v)}
            className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4-4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
            </svg>
            {market.workers.length} workers
            <ChevronDown className={`h-3 w-3 transition-transform ${showWorkers ? "rotate-180" : ""}`} />
          </button>

          {totalBets > zero && (
            <span className="flex items-center gap-1.5 text-slate-400">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
              </svg>
              {formatEther(totalBets)} ETH bets
            </span>
          )}

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
              <span>Resolved {market.resolution ? "YES" : "NO"}</span>
            ) : (
              <span>{formatRelativeDeadline(market)}</span>
            )}
          </span>
        </div>

        {/* Expandable Workers Panel */}
        {showWorkers && market.workerInfo.length > 0 && (
          <div className="mb-5 space-y-3 rounded-lg border border-navy-700/50 bg-navy-900/30 p-3">
            {market.workerInfo.map((w) => {
              const agent = AGENTS.find(
                (a) => a.address.toLowerCase() === w.address.toLowerCase()
              );
              const label = agent?.name ?? `${w.address.slice(0, 6)}...${w.address.slice(-4)}`;
              return (
                <div key={w.address} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/20 text-[9px] font-bold text-accent">
                        {label[0]}
                      </div>
                      <a
                        href={etherscanAddress(w.address)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium text-slate-200 hover:text-accent transition-colors"
                      >
                        {label}
                      </a>
                      {agent && (
                        <a
                          href={trust8004Url(agent.agentId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 rounded-full border border-accent/20 bg-accent/5 px-1.5 py-0.5 text-[9px] text-accent hover:bg-accent/10 transition-colors"
                        >
                          <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                          </svg>
                          ERC-8004
                        </a>
                      )}
                    </div>
                    {w.reputation.count > 0 && (
                      <span className="text-[10px] text-slate-500">
                        {w.reputation.count} resolution{w.reputation.count !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <MiniRepBar label="Res" value={w.reputation.resQuality} color="#3b82f6" />
                    <MiniRepBar label="Src" value={w.reputation.srcQuality} color="#8b5cf6" />
                    <MiniRepBar label="Depth" value={w.reputation.analysisDepth} color="#06b6d4" />
                  </div>
                </div>
              );
            })}
            <p className="text-[10px] text-slate-500 pt-1 border-t border-navy-700/50">
              Reputation sourced from ERC-8004 on-chain reviews &mdash;{" "}
              <a
                href="https://www.trust8004.xyz"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:text-blue-300 transition-colors"
              >
                verify on trust8004.xyz
              </a>
            </p>
          </div>
        )}

        {/* Join Market — Open markets with room */}
        {status === "open" && !marketFull && (
          <div className="mb-4">
            {!showJoin ? (
              <button
                onClick={() => setShowJoin(true)}
                className="w-full rounded-xl border border-dashed border-accent/30 bg-accent/5 px-4 py-2.5 text-sm font-medium text-accent transition-all hover:bg-accent/10 hover:border-accent/50"
              >
                + Join as Worker (stake 0.0001 ETH)
              </button>
            ) : (
              <div className="space-y-3 rounded-lg border border-navy-700/50 bg-navy-900/30 p-3">
                <p className="text-xs font-medium text-slate-400">Enter your ERC-8004 Agent ID:</p>

                {/* Agent ID input + verify */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={agentIdInput}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, "");
                      setAgentIdInput(v);
                      setOwnershipStatus("idle");
                      setOwnershipError("");
                    }}
                    placeholder="Agent ID (e.g. 1299)"
                    className="flex-1 rounded-lg border border-navy-700 bg-navy-900/50 px-3 py-2 text-sm font-mono text-white placeholder:text-slate-600 focus:outline-none focus:border-accent/40"
                  />
                  <button
                    onClick={handleVerifyAgent}
                    disabled={!address || !agentIdInput || Number(agentIdInput) <= 0 || ownershipStatus === "checking"}
                    className="rounded-lg border border-navy-700 bg-navy-800/50 px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-navy-700 hover:text-white disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {ownershipStatus === "checking" && <Loader2 className="h-3 w-3 animate-spin" />}
                    Verify
                  </button>
                </div>

                {/* Ownership result */}
                {ownershipStatus === "valid" && (
                  <div className="flex items-center gap-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-xs text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Wallet authorized for Agent #{agentIdInput}
                  </div>
                )}
                {ownershipStatus === "invalid" && (
                  <div className="flex items-center gap-1.5 rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">
                    <XCircle className="h-3.5 w-3.5" />
                    {ownershipError}
                  </div>
                )}

                {/* Stake info */}
                <div className="rounded-md bg-navy-800/50 px-3 py-2 text-xs text-slate-400">
                  Required stake: <span className="font-medium text-slate-200">0.0001 ETH</span>
                  {ethPrice && (
                    <span className="text-slate-500"> (~${(0.0001 * ethPrice).toFixed(2)})</span>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowJoin(false); setAgentIdInput(""); setOwnershipStatus("idle"); setOwnershipError(""); }}
                    className="flex-1 rounded-lg border border-navy-700 px-3 py-2 text-xs font-medium text-slate-400 transition-colors hover:text-slate-200"
                  >
                    Cancel
                  </button>
                  {!address ? (
                    <p className="flex-1 text-center text-xs text-slate-500 py-2">Connect wallet to join</p>
                  ) : (
                    <button
                      onClick={handleJoinMarket}
                      disabled={ownershipStatus !== "valid" || joinTxPending}
                      className="flex-1 rounded-lg bg-accent/20 px-3 py-2 text-xs font-semibold text-accent transition-all hover:bg-accent/30 disabled:opacity-50"
                    >
                      {joinTxPending ? "Joining..." : "Join Market"}
                    </button>
                  )}
                </div>

                {joinTxState.status !== "idle" && (
                  <TxBanner state={joinTxState} onDismiss={() => setJoinTxState({ status: "idle" })} />
                )}
              </div>
            )}
          </div>
        )}

        {/* Market full indicator */}
        {status === "open" && marketFull && (
          <div className="mb-4 rounded-lg bg-navy-900/30 border border-navy-700/50 p-3">
            <p className="text-center text-xs text-slate-500">Market full (10/10 workers)</p>
          </div>
        )}

        {/* Betting Section — Open Markets */}
        {status === "open" && binaryMarketDeployed && (
          <div className="mb-4 space-y-4">
            {/* Probability Bar */}
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-navy-900">
              <div className="bg-emerald-500 transition-all" style={{ width: `${probYes}%` }} />
              <div className="bg-red-500 transition-all" style={{ width: `${probNo}%` }} />
            </div>

            {/* USD Input (shadcn style) */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between rounded-lg border border-navy-600 bg-navy-900/50 p-1">
                <button
                  onClick={() => setUsdAmount(Math.max(10, usdAmount - 10))}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-navy-700 hover:text-white transition-colors"
                  disabled={usdAmount <= 10}
                >
                  <Minus className="h-4 w-4" />
                </button>

                <div className="flex items-center gap-1">
                  <span className="text-slate-400">$</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={usdAmount}
                    onChange={(e) => {
                      const v = Number(e.target.value.replace(/\D/g, ""));
                      if (!isNaN(v)) setUsdAmount(v);
                    }}
                    className="w-16 bg-transparent text-center font-mono text-sm font-medium text-white focus:outline-none"
                  />
                </div>

                <button
                  onClick={() => setUsdAmount(usdAmount + 10)}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-navy-700 hover:text-white transition-colors"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>

              <div className="flex justify-between px-1 text-[10px] text-slate-500">
                <span>Amount in USD</span>
                <span>&asymp; {ethPrice ? ethAmount : "..."} ETH</span>
              </div>
            </div>

            {/* Buy Buttons */}
            <div className="flex gap-3">
              <button
                onClick={handleBuyYes}
                disabled={txPending || !address || !ethPrice}
                className="group relative flex flex-1 items-center justify-between overflow-hidden rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 transition-all hover:bg-emerald-500/20 hover:border-emerald-500/50 disabled:opacity-50"
              >
                <span className="font-semibold text-emerald-400">Buy Yes</span>
                <span className="font-mono text-sm text-emerald-400/80">{probYes}%</span>
              </button>
              <button
                onClick={handleBuyNo}
                disabled={txPending || !address || !ethPrice}
                className="group relative flex flex-1 items-center justify-between overflow-hidden rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 transition-all hover:bg-red-500/20 hover:border-red-500/50 disabled:opacity-50"
              >
                <span className="font-semibold text-red-400">Buy No</span>
                <span className="font-mono text-sm text-red-400/80">{probNo}%</span>
              </button>
            </div>

            {!address && (
              <p className="text-center text-xs text-slate-500">Connect wallet to place bets</p>
            )}

            {/* Transaction Status Banner */}
            {txState.status !== "idle" && (
              <TxBanner state={txState} onDismiss={() => setTxState({ status: "idle" })} />
            )}
          </div>
        )}

        {/* Fallback: mock buttons when BinaryMarket not deployed */}
        {status === "open" && !binaryMarketDeployed && (
          <div className="mb-4 space-y-3">
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-navy-900">
              <div className="bg-emerald-500 transition-all" style={{ width: "50%" }} />
              <div className="bg-red-500 transition-all" style={{ width: "50%" }} />
            </div>
            <div className="flex gap-3">
              <button className="group relative flex flex-1 items-center justify-between overflow-hidden rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 transition-all hover:bg-emerald-500/20 hover:border-emerald-500/50 opacity-50 cursor-not-allowed">
                <span className="font-semibold text-emerald-400">Buy Yes</span>
                <span className="font-mono text-sm text-emerald-400/80">50%</span>
              </button>
              <button className="group relative flex flex-1 items-center justify-between overflow-hidden rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 transition-all hover:bg-red-500/20 hover:border-red-500/50 opacity-50 cursor-not-allowed">
                <span className="font-semibold text-red-400">Buy No</span>
                <span className="font-mono text-sm text-red-400/80">50%</span>
              </button>
            </div>
            <p className="text-center text-xs text-slate-500">BinaryMarket not deployed yet</p>
          </div>
        )}

        {/* Awaiting resolution */}
        {status === "awaiting_resolution" && !resolutionRequested && (
          <div className="mb-4 space-y-3">
            <div className="rounded-lg bg-amber-500/10 p-3 border border-amber-500/20">
              <p className="text-xs text-amber-400/90">
                Deadline passed &mdash; this market is ready to be resolved via the CRE workflow.
              </p>
            </div>
            {!address ? (
              <p className="text-center text-xs text-slate-500">Connect wallet to request resolution</p>
            ) : (
              <button
                onClick={handleRequestResolution}
                disabled={txPending}
                className="w-full rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm font-semibold text-amber-400 transition-all hover:bg-amber-500/20 hover:border-amber-500/50 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {txPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Request Resolution
              </button>
            )}
            {txState.status !== "idle" && (
              <TxBanner state={txState} onDismiss={() => setTxState({ status: "idle" })} />
            )}
          </div>
        )}

        {/* Resolution requested confirmation */}
        {status === "awaiting_resolution" && resolutionRequested && (
          <div className="mb-4 rounded-lg bg-emerald-500/10 p-3 border border-emerald-500/20">
            <p className="text-xs text-emerald-400/90">
              Resolution requested! The CRE workflow will process this shortly.
            </p>
          </div>
        )}

        {/* Resolved: Settle + Claim */}
        {status === "resolved" && (
          <div className="mb-4 space-y-3">
            <div className="rounded-lg bg-blue-500/10 p-3 border border-blue-500/20">
              <p className="text-xs text-blue-400/90">
                Market resolved <span className="font-semibold">{market.resolution ? "YES" : "NO"}</span> &mdash; rewards distributed and reputation updated.
              </p>
            </div>

            {binaryMarketDeployed && pool && !pool.settled && totalBets > zero && (
              <button
                onClick={handleSettle}
                disabled={txPending || !address}
                className="w-full rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm font-semibold text-amber-400 transition-all hover:bg-amber-500/20 disabled:opacity-50"
              >
                Settle (earn 1% fee: {formatEther((totalBets * feeBps) / bps)} ETH)
              </button>
            )}

            {binaryMarketDeployed && pool?.settled && (
              <button
                onClick={handleClaim}
                disabled={txPending || !address}
                className="w-full rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm font-semibold text-emerald-400 transition-all hover:bg-emerald-500/20 disabled:opacity-50"
              >
                Claim Winnings
              </button>
            )}

            {txState.status !== "idle" && (
              <TxBanner state={txState} onDismiss={() => setTxState({ status: "idle" })} />
            )}
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

// ─── Mini Reputation Bar ─────────────────────────────────────────────────────

function MiniRepBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[9px]">
        <span className="text-slate-500">{label}</span>
        <span className="text-slate-400">{value}</span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-navy-700">
        <div className="h-full rounded-full transition-all" style={{ width: `${value}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

// ─── Transaction Status Banner ───────────────────────────────────────────────

function TxBanner({ state, onDismiss }: { state: TxState; onDismiss: () => void }) {
  const etherscanTx = (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`;

  if (state.status === "pending") {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-blue-500/10 border border-blue-500/20 px-3 py-2 text-xs text-blue-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>Confirm in your wallet...</span>
      </div>
    );
  }

  if (state.status === "confirming") {
    return (
      <div className="flex items-center justify-between rounded-lg bg-blue-500/10 border border-blue-500/20 px-3 py-2 text-xs text-blue-400">
        <div className="flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>Waiting for confirmation...</span>
        </div>
        <a
          href={etherscanTx(state.hash)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 hover:text-blue-300 transition-colors"
        >
          View <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    );
  }

  if (state.status === "success") {
    return (
      <div className="flex items-center justify-between rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-xs text-emerald-400">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span>Transaction confirmed!</span>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={etherscanTx(state.hash)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-emerald-300 transition-colors"
          >
            View <ExternalLink className="h-3 w-3" />
          </a>
          <button onClick={onDismiss} className="text-emerald-500/50 hover:text-emerald-400 transition-colors">&times;</button>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex items-center justify-between rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">
        <div className="flex items-center gap-2 min-w-0">
          <XCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{state.message}</span>
        </div>
        <button onClick={onDismiss} className="shrink-0 text-red-500/50 hover:text-red-400 transition-colors">&times;</button>
      </div>
    );
  }

  return null;
}
