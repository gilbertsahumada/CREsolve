import Header from "@/components/Header";
import PipelineVisualizer from "@/components/PipelineVisualizer";
import AgentGrid from "@/components/AgentGrid";
import MarketList from "@/components/MarketList";
import { TooltipProvider } from "@/components/ui/tooltip";

export default function DashboardPage() {
  return (
    <TooltipProvider>
      <Header />
      <main className="mx-auto max-w-7xl space-y-8 px-6 py-8">
        <PipelineVisualizer />
        <AgentGrid />
        <MarketList />
      </main>
      <footer className="border-t border-navy-700 py-6 text-center text-xs text-slate-400">
        CREsolver &mdash; <a href="https://eips.ethereum.org/EIPS/eip-8004" target="_blank" rel="noopener noreferrer" className="text-slate-300 hover:text-white transition-colors">ERC-8004</a> Verifiable Agents + Chainlink CRE &mdash; Sepolia Testnet
      </footer>
    </TooltipProvider>
  );
}
