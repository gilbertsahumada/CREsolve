/**
 * Single source of truth for ERC-8004 agent profile data.
 *
 * If you need to change registration JSON fields or on-chain metadata keys,
 * edit this file only.
 */

export interface AgentProfileInput {
  name: string;
  address: string;
  agentId: number;
}

export interface AgentProfileContext {
  chainId: bigint;
  identityRegistry: string;
}

export interface OnchainMetadataEntry {
  key: string;
  abiType: "address" | "string";
  value: string;
}

const PROFILE_VERSION = "registration-v1";
const REGISTRATION_TYPE = "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";
const REPOSITORY_URL = "https://github.com/gilbertsahumada/chaoschain/tree/main/cresolver";
const INCLUDE_REPOSITORY_SERVICE = true;

function svgDataUri(label: string): string {
  const escaped = label
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="100%" height="100%" fill="#0f172a"/><text x="50%" y="48%" dominant-baseline="middle" text-anchor="middle" fill="#f8fafc" font-size="42" font-family="Arial">CREsolver</text><text x="50%" y="62%" dominant-baseline="middle" text-anchor="middle" fill="#cbd5e1" font-size="28" font-family="Arial">${escaped}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export function buildAgentRegistryRef(context: AgentProfileContext): string {
  return `eip155:${context.chainId}:${context.identityRegistry}`;
}

export function buildRegistrationFile(
  agent: AgentProfileInput,
  context: AgentProfileContext,
): Record<string, unknown> {
  const services: Array<{ name: string; endpoint: string }> = [
    {
      name: "wallet",
      endpoint: `eip155:${context.chainId}:${agent.address}`,
    },
  ];

  if (INCLUDE_REPOSITORY_SERVICE) {
    services.push({
      name: "repository",
      endpoint: REPOSITORY_URL,
    });
  }

  return {
    type: REGISTRATION_TYPE,
    name: `CREsolver ${agent.name}`,
    description:
      `CREsolver worker agent ${agent.name} for decentralized prediction market resolution.`,
    image: svgDataUri(agent.name),
    services,
    x402Support: false,
    active: true,
    registrations: [
      {
        agentId: agent.agentId,
        agentRegistry: buildAgentRegistryRef(context),
      },
    ],
    supportedTrust: ["reputation"],
  };
}

export function buildAgentDataUri(
  agent: AgentProfileInput,
  context: AgentProfileContext,
): string {
  const registration = buildRegistrationFile(agent, context);
  return `data:application/json;base64,${Buffer.from(JSON.stringify(registration)).toString("base64")}`;
}

export function buildOnchainMetadataEntries(
  agent: AgentProfileInput,
  context: AgentProfileContext,
  deployerAddress: string,
): OnchainMetadataEntry[] {
  return [
    {
      key: "workerAddress",
      abiType: "address",
      value: agent.address,
    },
    {
      key: "ownerAddress",
      abiType: "address",
      value: deployerAddress,
    },
    {
      key: "agentRegistry",
      abiType: "string",
      value: buildAgentRegistryRef(context),
    },
    {
      key: "profileVersion",
      abiType: "string",
      value: PROFILE_VERSION,
    },
  ];
}
