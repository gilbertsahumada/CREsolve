import type { MarketStatus } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

const config: Record<MarketStatus, { label: string; variant: "open" | "awaiting" | "resolved"; dotColor: string; pulse: boolean }> = {
  open: {
    label: "Open",
    variant: "open",
    dotColor: "bg-emerald-400",
    pulse: true,
  },
  awaiting_resolution: {
    label: "Awaiting Resolution",
    variant: "awaiting",
    dotColor: "bg-amber-400",
    pulse: false,
  },
  resolved: {
    label: "Resolved",
    variant: "resolved",
    dotColor: "bg-blue-400",
    pulse: false,
  },
};

export default function StatusBadge({ status }: { status: MarketStatus }) {
  const { label, variant, dotColor, pulse } = config[status];
  return (
    <Badge variant={variant} className="shrink-0">
      <span className={`h-1.5 w-1.5 rounded-full ${dotColor} ${pulse ? "pulse-dot" : ""}`} />
      {label}
    </Badge>
  );
}
