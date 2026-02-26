import type { MarketStatus } from "@/lib/types";

const config: Record<MarketStatus, { label: string; style: string }> = {
  open: {
    label: "Open",
    style: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  },
  awaiting_resolution: {
    label: "Awaiting Resolution",
    style: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  },
  resolved: {
    label: "Resolved",
    style: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  },
};

export default function StatusBadge({ status }: { status: MarketStatus }) {
  const { label, style } = config[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${style}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          status === "open"
            ? "bg-emerald-400 pulse-dot"
            : status === "awaiting_resolution"
              ? "bg-amber-400"
              : "bg-blue-400"
        }`}
      />
      {label}
    </span>
  );
}
