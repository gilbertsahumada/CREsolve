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
        <div className="hidden items-center gap-1 md:flex">
          {STEPS.map((step, i) => (
            <div key={step.label} className="flex items-center gap-1 flex-1">
              <div className="flex flex-col items-center gap-1 flex-1">
                <Badge variant="outline" className="flex h-10 w-10 items-center justify-center rounded-full border-accent/30 bg-accent/20 text-xs font-bold text-accent p-0">
                  {i + 1}
                </Badge>
                <span className="text-xs font-semibold text-white">
                  {step.label}
                </span>
                <span className="text-[11px] text-slate-400">{step.desc}</span>
              </div>
              {i < STEPS.length - 1 && <div className="pipeline-connector" />}
            </div>
          ))}
        </div>

        {/* Mobile: vertical */}
        <div className="flex flex-col gap-3 md:hidden">
          {STEPS.map((step, i) => (
            <div key={step.label} className="flex items-center gap-3">
              <Badge variant="outline" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-accent/30 bg-accent/20 text-xs font-bold text-accent p-0">
                {i + 1}
              </Badge>
              <div>
                <span className="text-sm font-semibold text-white">
                  {step.label}
                </span>
                <span className="ml-2 text-xs text-slate-400">{step.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
