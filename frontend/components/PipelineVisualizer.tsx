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
    <section className="rounded-xl border border-navy-700 bg-navy-800/50 p-6">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">
        CRE Resolution Pipeline
      </h2>

      {/* Desktop: horizontal */}
      <div className="hidden items-center gap-1 md:flex">
        {STEPS.map((step, i) => (
          <div key={step.label} className="flex items-center gap-1 flex-1">
            <div className="flex flex-col items-center gap-1 flex-1">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/20 text-xs font-bold text-accent">
                {i + 1}
              </div>
              <span className="text-xs font-semibold text-white">
                {step.label}
              </span>
              <span className="text-[10px] text-slate-400">{step.desc}</span>
            </div>
            {i < STEPS.length - 1 && <div className="pipeline-connector" />}
          </div>
        ))}
      </div>

      {/* Mobile: vertical */}
      <div className="flex flex-col gap-3 md:hidden">
        {STEPS.map((step, i) => (
          <div key={step.label} className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/20 text-xs font-bold text-accent">
              {i + 1}
            </div>
            <div>
              <span className="text-sm font-semibold text-white">
                {step.label}
              </span>
              <span className="ml-2 text-xs text-slate-400">{step.desc}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
