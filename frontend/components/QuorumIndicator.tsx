import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

interface QuorumIndicatorProps {
  total: number;
  responded?: number;
}

/** BFT quorum: ceil(2n/3) */
function bftQuorum(n: number): number {
  return Math.ceil((2 * n) / 3);
}

export default function QuorumIndicator({
  total,
  responded,
}: QuorumIndicatorProps) {
  const quorum = bftQuorum(total);
  const tolerance = Math.floor((total - 1) / 3);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-3 cursor-default">
          <div className="flex gap-1">
            {Array.from({ length: total }, (_, i) => (
              <div
                key={i}
                className={`h-3 w-3 rounded-full transition-colors ${
                  responded !== undefined && i < responded
                    ? "bg-emerald-400"
                    : i < quorum
                      ? "bg-accent/40"
                      : "bg-navy-700"
                }`}
              />
            ))}
          </div>
          <span className="text-xs text-slate-400">
            BFT {quorum}/{total} (tolerates {tolerance} fault
            {tolerance !== 1 ? "s" : ""})
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <p>BFT quorum = ceil(2n/3) = {quorum} of {total} agents</p>
        <p className="text-slate-400">Tolerates up to {tolerance} faulty node{tolerance !== 1 ? "s" : ""}</p>
      </TooltipContent>
    </Tooltip>
  );
}
