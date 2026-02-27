import { createPublicClient, http, type Address } from "viem";
import { CHAIN, CONTRACTS, RPC_URL } from "./config";
import { isAuthorizedOrOwnerAbi } from "./contracts";

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
