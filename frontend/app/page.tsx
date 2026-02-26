import Header from "@/components/Header";
import PipelineVisualizer from "@/components/PipelineVisualizer";
import AgentGrid from "@/components/AgentGrid";
import MarketList from "@/components/MarketList";

export default function DashboardPage() {
  return (
    <>
      <Header />
      <main className="mx-auto max-w-7xl space-y-8 px-6 py-8">
        <PipelineVisualizer />
        <AgentGrid />
        <MarketList />
      </main>
      <footer className="border-t border-navy-700 py-6 text-center text-xs text-slate-500">
        CREsolver &mdash; Chainlink CRE + AI Agents &mdash; Sepolia Testnet
      </footer>
    </>
  );
}
