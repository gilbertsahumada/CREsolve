import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const STEPS = [
  { label: "READ", desc: "On-chain data" },
  { label: "ASK", desc: "Query agents" },
  { label: "CHALLENGE", desc: "Cross-examine" },
  { label: "EVALUATE", desc: "Score & consensus" },
  { label: "RESOLVE", desc: "Final decision" },
  { label: "WRITE", desc: "DON report" },
];

export default function PipelineVisualizer() {
  return (
    <Card>
      <CardContent className="p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-300">
          CRE Resolution Pipeline
        </h2>

        {/* Desktop: horizontal */}
        <div className="relative hidden md:block">
          {/* Solid line + traveling pulse */}
          <div className="pipeline-line-h" />

          {/* Steps on top */}
          <div className="relative z-10 flex">
            {STEPS.map((step, i) => (
              <div
                key={step.label}
                className="flex flex-1 flex-col items-center gap-1"
              >
                <Badge
                  variant="outline"
                  className={`pipeline-step pipeline-step-${i} flex h-10 w-10 items-center justify-center rounded-full border-[#1a3a2a] bg-[#132d22] text-xs font-bold text-accent p-0`}
                >
                  {i + 1}
                </Badge>
                <span className="text-xs font-semibold text-white">
                  {step.label}
                </span>
                <span className="text-[11px] text-slate-400">{step.desc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Mobile: vertical */}
        <div className="relative md:hidden">
          {/* Solid vertical line + traveling pulse */}
          <div className="pipeline-line-v" />

          {/* Steps on top */}
          <div className="relative z-10 flex flex-col gap-4">
            {STEPS.map((step, i) => (
              <div key={step.label} className="flex items-center gap-3">
                <Badge
                  variant="outline"
                  className={`pipeline-step pipeline-step-${i} flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-[#1a3a2a] bg-[#132d22] text-xs font-bold text-accent p-0`}
                >
                  {i + 1}
                </Badge>
                <div>
                  <span className="text-sm font-semibold text-white">
                    {step.label}
                  </span>
                  <span className="ml-2 text-xs text-slate-400">
                    {step.desc}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
