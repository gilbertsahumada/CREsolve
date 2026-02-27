"use client";

import { useState, useEffect } from "react";
import { parseEther, encodeFunctionData } from "viem";
import { Loader2, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import { useWallet, useEthPrice, waitForTx } from "@/lib/hooks";
import { CONTRACTS } from "@/lib/config";
import { createMarketAbi } from "@/lib/contracts";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type TxState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "confirming"; hash: string }
  | { status: "success"; hash: string }
  | { status: "error"; message: string };

type DurationUnit = "minutes" | "hours" | "days";

const UNIT_SECONDS: Record<DurationUnit, number> = {
  minutes: 60,
  hours: 3600,
  days: 86400,
};

export default function CreateMarketModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { address } = useWallet();
  const ethPrice = useEthPrice();

  const [question, setQuestion] = useState("");
  const [durationValue, setDurationValue] = useState<number>(1);
  const [durationUnit, setDurationUnit] = useState<DurationUnit>("hours");
  const [reward, setReward] = useState("0.01");
  const [txState, setTxState] = useState<TxState>({ status: "idle" });

  const txPending = txState.status === "pending" || txState.status === "confirming";
  const isValid = question.trim().length > 0 && durationValue > 0 && Number(reward) > 0;

  // Auto-close after success
  useEffect(() => {
    if (txState.status === "success") {
      const timer = setTimeout(() => {
        onSuccess();
        onClose();
        setTxState({ status: "idle" });
        setQuestion("");
        setDurationValue(1);
        setDurationUnit("hours");
        setReward("0.01");
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [txState.status, onSuccess, onClose]);

  async function handleSubmit() {
    if (!window.ethereum || !address) {
      alert("Please connect your wallet first.");
      return;
    }
    if (!isValid) return;

    const durationSeconds = BigInt(Math.floor(durationValue * UNIT_SECONDS[durationUnit]));
    const data = encodeFunctionData({
      abi: createMarketAbi,
      functionName: "createMarket",
      args: [question.trim(), durationSeconds],
    });
    const value = parseEther(reward);

    setTxState({ status: "pending" });
    try {
      const hash = (await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: address,
            to: CONTRACTS.market,
            data,
            value: `0x${value.toString(16)}`,
          },
        ],
      })) as string;

      setTxState({ status: "confirming", hash });
      await waitForTx(hash as `0x${string}`);
      setTxState({ status: "success", hash });
    } catch (err: any) {
      if (err.code === 4001) {
        setTxState({ status: "idle" });
      } else {
        const message = err?.message?.slice(0, 120) ?? "Transaction failed";
        setTxState({ status: "error", message });
        setTimeout(
          () => setTxState((s) => (s.status === "error" ? { status: "idle" } : s)),
          8000
        );
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Market</DialogTitle>
          <DialogDescription>
            Create a new prediction market with a question, deadline, and ETH reward pool.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-5">
          {/* Question */}
          <div className="space-y-2">
            <Label htmlFor="question">Question</Label>
            <Textarea
              id="question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What will happen?"
              rows={3}
              className="resize-none"
            />
          </div>

          {/* Duration */}
          <div className="space-y-2">
            <Label>Duration</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                min={1}
                value={durationValue}
                onChange={(e) => setDurationValue(Number(e.target.value))}
                className="w-24 font-mono"
              />
              <Select
                value={durationUnit}
                onValueChange={(v) => setDurationUnit(v as DurationUnit)}
              >
                <SelectTrigger className="w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="minutes">Minutes</SelectItem>
                  <SelectItem value="hours">Hours</SelectItem>
                  <SelectItem value="days">Days</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Reward Pool */}
          <div className="space-y-2">
            <Label htmlFor="reward">Reward Pool (ETH)</Label>
            <div className="relative">
              <Input
                id="reward"
                type="number"
                min={0.001}
                step={0.001}
                value={reward}
                onChange={(e) => setReward(e.target.value)}
                className="pr-24 font-mono"
              />
              {ethPrice && Number(reward) > 0 && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                  ~${(Number(reward) * ethPrice).toFixed(2)}
                </span>
              )}
            </div>
          </div>

          {/* Submit */}
          {!address ? (
            <p className="text-center text-xs text-slate-500 py-2">
              Connect wallet to create a market
            </p>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={!isValid || txPending}
              variant="accent"
              size="lg"
              className="w-full"
            >
              {txPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {txPending ? "Creating Market..." : "Create Market"}
            </Button>
          )}

          {/* Tx status */}
          {txState.status === "success" && (
            <div className="flex items-center justify-between rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-xs text-emerald-400">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>Market created!</span>
              </div>
              <a
                href={`https://sepolia.etherscan.io/tx/${txState.hash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 hover:text-emerald-300 transition-colors"
              >
                View <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}

          {txState.status === "error" && (
            <div className="flex items-center justify-between rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">
              <div className="flex items-center gap-2 min-w-0">
                <XCircle className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{txState.message}</span>
              </div>
              <button
                onClick={() => setTxState({ status: "idle" })}
                className="shrink-0 text-red-500/50 hover:text-red-400 transition-colors"
              >
                &times;
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
