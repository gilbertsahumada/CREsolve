interface ChangelogEntry {
  date: string;
  version: string;
  title: string;
  description: string;
  type: "feature" | "improvement" | "fix";
  highlights: string[];
}

const entries: ChangelogEntry[] = [
  {
    date: "2026-02-27",
    version: "v0.4.0",
    title: "User Betting + Resolver Incentives",
    description: "Users can now bet ETH on YES/NO outcomes via BinaryMarket companion contract. Anyone can trigger resolution and earn settlement fees.",
    type: "feature",
    highlights: [
      "BinaryMarket.sol: bet YES/NO with ETH, settle, and claim winnings",
      "Open requestResolution() to anyone — no more creator-only restriction",
      "1% settlement fee incentivizes fast resolution triggering",
      "Real-time pool data and probabilities in MarketCard",
      "On-chain resolution outcome stored in Market struct",
    ],
  },
  {
    date: "2026-02-27",
    version: "v0.3.0",
    title: "UI Overhaul & Wallet Connection",
    description: "Redesigned the prediction market cards for better UX and added Web3 wallet connection support for the Sepolia network.",
    type: "feature",
    highlights: [
      "Added Web3 wallet connection (MetaMask support)",
      "Redesigned MarketCard with probability bars",
      "Improved grid layout for market list",
      "Enhanced typography and contrast",
    ],
  },
  {
    date: "2026-02-27",
    version: "v0.2.0",
    title: "Prediction Market UI",
    description: "Added Buy and Sell buttons to open markets to improve the prediction market experience.",
    type: "feature",
    highlights: [
      "Added Buy and Sell buttons to open markets",
      "Improved MarketCard layout",
    ],
  },
  {
    date: "2026-02-26",
    version: "v0.1.0",
    title: "Dashboard Launch",
    description:
      "Read-only dashboard for CREsolver — visualizes Sepolia markets, agent reputation, and the CRE resolution pipeline.",
    type: "feature",
    highlights: [
      "Live market data from Sepolia via viem",
      "Agent reputation bars (3 on-chain dimensions)",
      "BFT quorum indicator with fault tolerance",
      "6-step pipeline visualizer",
      "Static export for Vercel deployment",
    ],
  },
];

const typeColors = {
  feature: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  improvement: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  fix: "bg-amber-500/10 text-amber-400 border-amber-500/30",
};

export default function ChangelogPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="mb-8 text-2xl font-bold text-white">Changelog</h1>

      <div className="space-y-8">
        {entries.map((entry) => (
          <article
            key={entry.version}
            className="rounded-xl border border-navy-700 bg-navy-800/50 p-6"
          >
            <div className="mb-3 flex items-center gap-3">
              <span className="font-mono text-sm font-semibold text-accent">
                {entry.version}
              </span>
              <span
                className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${typeColors[entry.type]}`}
              >
                {entry.type}
              </span>
              <span className="text-xs text-slate-500">{entry.date}</span>
            </div>

            <h2 className="mb-2 text-lg font-semibold text-white">
              {entry.title}
            </h2>
            <p className="mb-3 text-sm text-slate-400">{entry.description}</p>

            <ul className="space-y-1">
              {entry.highlights.map((h) => (
                <li
                  key={h}
                  className="flex items-start gap-2 text-sm text-slate-300"
                >
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  {h}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </main>
  );
}
