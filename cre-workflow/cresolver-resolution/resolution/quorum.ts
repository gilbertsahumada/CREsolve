/**
 * BFT Quorum – Byzantine Fault Tolerant supermajority for worker consensus.
 *
 * CREsolver uses a ⌈2n/3⌉ supermajority quorum, the same threshold used by
 * Chainlink CRE's own OCR (Off-Chain Reporting) protocol and classic BFT
 * consensus algorithms (PBFT, Tendermint, HotStuff).
 *
 * Why ⌈2n/3⌉?
 * -----------
 * In a system with n participants, up to f = ⌊(n-1)/3⌋ may be faulty
 * (offline, slow, or malicious). The remaining n - f honest participants
 * form a supermajority that guarantees:
 *
 *   - Safety:   No conflicting resolutions can both reach quorum.
 *   - Liveness: The system makes progress even with f failures.
 *
 * This is the theoretical optimum — tolerating more faults would require
 * sacrificing one of these guarantees (FLP impossibility).
 *
 * Quorum table (max 10 workers):
 * ┌─────────┬─────────────────┬───────────┐
 * │ Workers │ Quorum (⌈2n/3⌉) │ Tolerance │
 * ├─────────┼─────────────────┼───────────┤
 * │    1    │        1        │     0     │
 * │    2    │        2        │     0     │
 * │    3    │        2        │     1     │
 * │    4    │        3        │     1     │
 * │    5    │        4        │     1     │
 * │    6    │        4        │     2     │
 * │    7    │        5        │     2     │
 * │    8    │        6        │     2     │
 * │    9    │        6        │     3     │
 * │   10   │        7        │     3     │
 * └─────────┴─────────────────┴───────────┘
 *
 * References:
 * - Chainlink OCR: https://docs.chain.link/architecture-overview/off-chain-reporting
 * - PBFT (Castro & Liskov, 1999): n ≥ 3f + 1
 * - CRE DON consensus uses the same ⌈2n/3⌉ threshold internally
 */

/** Maximum number of workers supported per resolution. */
export const MAX_WORKERS = 10;

/**
 * Compute the BFT supermajority quorum for a given number of workers.
 *
 * @param totalWorkers - Total number of registered workers (1..MAX_WORKERS).
 * @returns The minimum number of responses required to proceed.
 * @throws If totalWorkers is out of the valid range.
 */
export function bftQuorum(totalWorkers: number): number {
  if (totalWorkers < 1 || totalWorkers > MAX_WORKERS) {
    throw new Error(
      `Worker count ${totalWorkers} out of range [1, ${MAX_WORKERS}]`,
    );
  }
  return Math.ceil((2 * totalWorkers) / 3);
}

/**
 * Maximum number of faulty workers the system can tolerate.
 *
 * @param totalWorkers - Total number of registered workers.
 * @returns f = ⌊(n-1)/3⌋
 */
export function bftFaultTolerance(totalWorkers: number): number {
  if (totalWorkers < 1) return 0;
  return Math.floor((totalWorkers - 1) / 3);
}
