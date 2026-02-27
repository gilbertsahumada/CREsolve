import { type Address } from "viem";
import { sepolia } from "viem/chains";

// ─── Sepolia contract addresses ──────────────────────────────────────────────

export const CHAIN = sepolia;

export const CONTRACTS = {
  market: "0x6E61036B4627e7bD0F8157Cf26dafbCCBE43DA96" as Address,
  binaryMarket: "0x7fbAD3cFc3cDa040C208d91c56FcB66dabe184a1" as Address,
  receiver: "0xFF10923B5Adbb688BDD789E38b2E8b673e96D1F9" as Address,
  identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e" as Address,
  reputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713" as Address,
} as const;

// ─── Static agent config (from sepolia-agents.public.json) ───────────────────

export interface AgentConfig {
  name: string;
  address: Address;
  agentId: number;
}

export const AGENTS: AgentConfig[] = [
  {
    name: "Alpha",
    address: "0x39dA71D28d9C33676f9B5f0d7e54c34B3B1BE77A",
    agentId: 1299,
  },
  {
    name: "Beta",
    address: "0x6df71140DA55a8A587b7CA140E64622D76eA0aE6",
    agentId: 1300,
  },
  {
    name: "Gamma",
    address: "0x937363c82BeA305369fD3e7475167b5363A2DA4D",
    agentId: 1301,
  },
];

// ─── External links ─────────────────────────────────────────────────────────

export function trust8004Url(agentId: number): string {
  return `https://www.trust8004.xyz/agents/${CHAIN.id}:${agentId}`;
}

export function etherscanAddress(address: string): string {
  return `https://sepolia.etherscan.io/address/${address}`;
}

// ─── RPC ─────────────────────────────────────────────────────────────────────

export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
