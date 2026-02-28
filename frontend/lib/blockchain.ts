import { createPublicClient, http, parseAbiItem, type Address } from "viem";
import { CHAIN, CONTRACTS, RPC_URL } from "./config";
import { isAuthorizedOrOwnerAbi, getAgentWalletAbi } from "./contracts";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const client = createPublicClient({
  chain: CHAIN,
  transport: http(RPC_URL),
});

export async function checkAgentOwnership(
  spender: Address,
  agentId: number
): Promise<boolean> {
  try {
    const result = await client.readContract({
      address: CONTRACTS.identityRegistry,
      abi: isAuthorizedOrOwnerAbi,
      functionName: "isAuthorizedOrOwner",
      args: [spender, BigInt(agentId)],
    });
    return result as boolean;
  } catch {
    // Reverts if agent doesn't exist (ERC721NonexistentToken)
    return false;
  }
}

export async function getAgentWallet(
  agentId: number
): Promise<Address | null> {
  try {
    const result = await client.readContract({
      address: CONTRACTS.identityRegistry,
      abi: getAgentWalletAbi,
      functionName: "getAgentWallet",
      args: [BigInt(agentId)],
    });
    const addr = result as Address;
    return addr === ZERO_ADDRESS ? null : addr;
  } catch {
    return null;
  }
}

export async function checkResolutionRequested(
  marketId: number
): Promise<boolean> {
  try {
    const logs = await client.getLogs({
      address: CONTRACTS.market,
      event: parseAbiItem(
        "event ResolutionRequested(uint256 indexed marketId, string question)"
      ),
      args: { marketId: BigInt(marketId) },
      fromBlock: "earliest",
      toBlock: "latest",
    });
    return logs.length > 0;
  } catch {
    return false;
  }
}
