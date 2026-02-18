# ChaosSettler v14 — Implementation Guide

> **Estado**: Fases 1-3 completadas. Fase 4 (Deploy Sepolia + Polish) pendiente.
>
> Reference document with all code to write. Implementado en `cresolver/` (subdir de chaoschain, branch `hackathon/chaos-settler`).

---

## Progress Summary

| Sección | Componente | Estado | Notas |
|---------|-----------|--------|-------|
| A | RewardsDistributor.sol mods | ✅ | resolveAndDistribute + helpers |
| B | ResolutionMarketLogic.sol | ✅ | LogicModule en packages/contracts/ |
| C | CREReceiver.sol | ✅ | En packages/contracts/ y cresolver/contracts/ |
| D | CREReceiver.t.sol | ✅ | Tests en cresolver/contracts/test/ |
| E | ResolveAndDistribute.t.sol | ⬜ | Pendiente en packages/contracts/test/ |
| F | ResolutionMarketLogic.t.sol | ⬜ | Pendiente en packages/contracts/test/ |
| G | Deploy script | ✅ | cresolver/contracts/script/Deploy.s.sol |
| Part 2 | CRE Workflow (6 steps) | ✅ | cresolver/cre-workflow/src/ |
| Part 2 | Worker Agent | ✅ | cresolver/agent/src/ (TypeScript/Hono, no Python) |
| Part 2 | Scripts | ✅ | cresolver/scripts/ (setup-demo, demo-run) |
| Extra | CREsolverMarket.sol (standalone) | ✅ | cresolver/contracts/src/ |
| Extra | E2E Docker Sandbox | ✅ | cresolver/e2e/ + docker-compose.e2e.yml (12 tests) |
| — | `_epochResolved` guard | ⬜ | Pendiente §3.4 de BLUEPRINT |
| — | Deploy Base Sepolia | ⬜ | Fase 4 |
| — | WASM build para DON | ⬜ | Fase 4 |

### Cambios vs Plan Original

- **Agent**: Implementado en TypeScript/Hono (no Python/FastAPI)
- **Contrato**: `CREsolverMarket.sol` standalone adicional para E2E (no depende de StudioProxy)
- **E2E**: Docker Compose sandbox con Anvil + 3 agents + vitest (no existía en plan original)
- **Repo**: Todo en `cresolver/` subdirectory (no repo separado `chaossettler/`)

---

## Repository Structure

### Repo 1: `chaoschain` (branch `hackathon/chaossettler`)

```
packages/contracts/
├── src/
│   ├── RewardsDistributor.sol          ← MODIFIED (+65 lines)
│   ├── CREReceiver.sol                 ← NEW (Chainlink CRE bridge)
│   └── logic/
│       └── ResolutionMarketLogic.sol   ← NEW
├── test/
│   ├── ResolveAndDistribute.t.sol      ← NEW
│   ├── CREReceiver.t.sol              ← NEW
│   └── ResolutionMarketLogic.t.sol     ← NEW
└── script/
    └── DeployChaosSettler.s.sol         ← NEW
```

### ~~Repo 2: `chaossettler` (new repo)~~ → Implementado como `cresolver/` subdirectory

```
cresolver/                              # ✅ Implementado
├── package.json                        # ✅ Root scripts (yarn e2e)
├── docker-compose.e2e.yml              # ✅ E2E sandbox
├── .gitignore                          # ✅
├── contracts/                          # ✅ Foundry project
│   ├── src/
│   │   ├── CREsolverMarket.sol         # ✅ Standalone market contract
│   │   └── CREReceiver.sol             # ✅ Keystone bridge
│   ├── test/
│   │   ├── CREsolverMarket.t.sol       # ✅
│   │   └── CREReceiver.t.sol           # ✅
│   ├── script/Deploy.s.sol             # ✅
│   └── out/                            # Compiled artifacts
├── cre-workflow/                       # ✅ Resolution workflow
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                    # ✅ Orchestrator
│       ├── types.ts                    # ✅
│       ├── abi.ts                      # ✅
│       ├── step1-read.ts              # ✅
│       ├── step2-ask.ts               # ✅
│       ├── step3-challenge.ts         # ✅
│       ├── step4-evaluate.ts          # ✅
│       ├── step5-resolve.ts           # ✅
│       └── step6-write.ts             # ✅
├── agent/                              # ✅ TypeScript/Hono (not Python)
│   ├── package.json
│   ├── yarn.lock
│   ├── Dockerfile                      # ✅ Node 20 alpine + tsx
│   ├── src/
│   │   ├── index.ts                    # ✅ Hono server
│   │   ├── config.ts                   # ✅
│   │   ├── validation.ts              # ✅
│   │   ├── routes/
│   │   │   ├── health.ts              # ✅ GET /health
│   │   │   └── a2a.ts                 # ✅ POST /a2a/resolve, /a2a/challenge
│   │   └── services/
│   │       ├── investigator.ts        # ✅ Mock + LLM modes
│   │       └── defender.ts            # ✅
│   └── tests/agent.test.ts            # ✅
├── scripts/                            # ✅ Demo utilities
│   ├── package.json
│   ├── setup-demo.ts                   # ✅ Deploy + fund + markets
│   ├── demo-run.ts                     # ✅ Full resolution loop
│   └── demo-config.json                # Generated (gitignored)
├── shared/
│   └── types.ts                        # ✅ Shared TS types
├── e2e/                                # ✅ E2E test suite
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.e2e.config.ts            # ✅ 120s timeout
│   ├── setup.ts                        # ✅ Deploy + wait + create markets
│   ├── helpers.ts                      # ✅ Health poll + on-chain verify
│   ├── e2e.test.ts                     # ✅ 12 tests
│   └── demo-config.json                # Generated (gitignored)
└── docs/                               # Historical iterations
    └── ...
```

---

## CRE ARCHITECTURE — KeystoneForwarder Pattern

> **Critical finding**: Chainlink CRE does **NOT** call arbitrary contract functions directly.
> CRE uses the **KeystoneForwarder** pattern: workflows produce a DON-signed report via
> `runtime.report()`, and the CRE runtime delivers it through `KeystoneForwarder.report()`,
> which calls `onReport(metadata, report)` on the receiver contract.

### Flow Diagram

```
CRE Workflow         CRE Runtime         KeystoneForwarder        CREReceiver         RewardsDistributor
     │                    │                      │                      │                      │
     │──runtime.report()─>│                      │                      │                      │
     │  (encoded payload) │──report()────────────>│                      │                      │
     │                    │  (DON-signed)         │──onReport(meta,rpt)─>│                      │
     │                    │                      │                      │──decode report────────│
     │                    │                      │                      │──resolveAndDistribute>│
     │                    │                      │                      │<──ok──────────────────│
     │                    │                      │<──ok─────────────────│                      │
```

### Key Details

- **KeystoneForwarder**: Base Sepolia CRE Simulation Forwarder = `0x82300bd7c3958625581cc2f77bc6464dcecdf3e5`
- **IReceiver interface**: Receiver contracts must implement `onReport(bytes calldata metadata, bytes calldata report)`
- **msg.sender**: Inside `onReport()`, `msg.sender` is the KeystoneForwarder address
- **Authorization**: `setAuthorizedResolver()` must authorize the **CREReceiver** address (not the forwarder)
- **Report encoding**: CRE workflow encodes the resolution payload with `abi.encode(studio, epoch, workers[], weights[], dimScores[], resolution)`, which `CREReceiver.onReport()` decodes and forwards (Option 4: blinded — no determinations on-chain)

### CRE SDK Pattern (step6-write.ts)

In the CRE workflow, Step 6 does NOT use `ethers.Contract.resolveAndDistribute()` directly.
Instead, it uses:

```typescript
// Inside CRE workflow capability (Option 4: blinded weights)
const payload = abi.encode(
  ['address', 'uint64', 'address[]', 'uint256[]', 'uint8[]', 'bool'],
  [studio, epoch, workers, weights, dimScores, resolution]
);
runtime.report(payload);  // DON signs + KeystoneForwarder delivers
```

For **local demo/testing** (without CRE DON), step6-write.ts calls `resolveAndDistribute()` directly
via an authorized signer (simulating the CRE DON role).

---

## PART 1: CHAOSCHAIN BRANCH CHANGES

---

### A. RewardsDistributor.sol — Modifications

**File**: `packages/contracts/src/RewardsDistributor.sol`

#### A1. Add state variables (after line 61, after `_workValidators`)

```solidity
    // ============ ChaosSettler Resolution State ============

    /// @dev Authorized external resolvers (e.g., CRE DON address)
    mapping(address => bool) public authorizedResolvers;

    /// @dev Emitted when a resolver is authorized/deauthorized
    event ResolverUpdated(address indexed resolver, bool authorized);

    /// @dev Emitted when a market resolution is completed via resolveAndDistribute
    event ResolutionCompleted(
        address indexed studio,
        uint64 indexed epoch,
        bool resolution,
        uint256 totalDistributed,
        uint256 workerCount
    );
```

#### A2. Add modifier (after constructor, after line 72)

```solidity
    /// @dev Allow owner or authorized resolvers (CRE DON)
    modifier onlyOwnerOrResolver() {
        require(
            msg.sender == owner() || authorizedResolvers[msg.sender],
            "Not authorized resolver"
        );
        _;
    }
```

#### A3. Add setAuthorizedResolver (after setConsensusParameters, after line 529)

```solidity
    /**
     * @notice Authorize or deauthorize an external resolver (e.g., CRE DON)
     * @param resolver The resolver address
     * @param authorized True to authorize, false to revoke
     */
    function setAuthorizedResolver(address resolver, bool authorized) external onlyOwner {
        require(resolver != address(0), "Invalid resolver");
        authorizedResolvers[resolver] = authorized;
        emit ResolverUpdated(resolver, authorized);
    }
```

#### A4. Add resolveAndDistribute — Option 4: Blinded (after setAuthorizedResolver)

This is the main function called by the CRE DON after evaluating oracle workers.
**Option 4**: CRE pre-computes `weights[]` (quality × correctnessMult × reputation) off-chain
so individual votes (determinations) never appear on-chain. Publishes 3-dimensional reputation
without accuracy tags.

```solidity
    /**
     * @notice Resolve a prediction market and distribute rewards (Option 4: Blinded)
     * @dev Called by CRE DON after off-chain oracle evaluation.
     *      CRE pre-computes weights (quality × correctnessMult × reputation) off-chain
     *      so individual votes (determinations) never appear on-chain.
     *
     * Flow:
     * 1. Validate inputs and authorization
     * 2. Calculate reward pool (totalEscrow - sum of stakes)
     * 3. Distribute rewards proportional to pre-computed weights
     * 4. Return stakes to all workers
     * 5. Publish 3-dimensional reputation (no accuracy tag)
     * 6. Track epoch work
     *
     * @param studio The StudioProxy address
     * @param epoch The epoch number for tracking
     * @param workers Array of worker addresses (oracles who participated)
     * @param weights Pre-computed weights per worker (quality × correctnessMult × reputation)
     * @param dimScores Flat array of 3 dimension scores per worker:
     *        [w0_resQuality, w0_srcQuality, w0_analysisDepth, w1_resQuality, ...]
     * @param resolution The final weighted resolution (true/false)
     */
    function resolveAndDistribute(
        address studio,
        uint64 epoch,
        address[] calldata workers,
        uint256[] calldata weights,
        uint8[] calldata dimScores,
        bool resolution
    ) external onlyOwnerOrResolver {
        // --- Validations ---
        require(studio != address(0), "Invalid Studio");
        require(workers.length > 0, "No workers");
        require(workers.length <= 10, "Too many workers");
        require(workers.length == weights.length, "Array length mismatch");
        require(dimScores.length == workers.length * 3, "DimScores length mismatch");

        StudioProxy studioProxy = StudioProxy(payable(studio));

        // --- Calculate reward pool ---
        uint256 totalEscrow = studioProxy.getTotalEscrow();
        uint256 totalStakes = 0;
        uint256 totalWeight = 0;

        for (uint256 i = 0; i < workers.length; i++) {
            uint256 agentId = studioProxy.getAgentId(workers[i]);
            require(agentId != 0, "Worker not registered");
            totalStakes += studioProxy.getAgentStake(agentId);
            totalWeight += weights[i];
        }

        require(totalEscrow > totalStakes, "No reward pool");
        require(totalWeight > 0, "Zero total weight");
        uint256 rewardPool = totalEscrow - totalStakes;

        // --- Distribute rewards + return stakes ---
        uint256 totalDistributed = 0;
        bytes32 resolutionHash = keccak256(
            abi.encodePacked(studio, epoch, resolution, block.timestamp)
        );

        for (uint256 i = 0; i < workers.length; i++) {
            uint256 agentId = studioProxy.getAgentId(workers[i]);

            // Calculate proportional reward from pre-computed weights
            uint256 reward = (rewardPool * weights[i]) / totalWeight;
            uint256 stake = studioProxy.getAgentStake(agentId);

            // Release reward
            if (reward > 0) {
                studioProxy.releaseFunds(workers[i], reward, resolutionHash);
                totalDistributed += reward;
            }

            // Return stake
            if (stake > 0) {
                studioProxy.releaseFunds(workers[i], stake, resolutionHash);
            }

            // Publish 3-dimensional reputation (no accuracy tag — blinded)
            _publishResolutionReputation(
                agentId,
                dimScores[i * 3],       // Resolution Quality
                dimScores[i * 3 + 1],   // Source Quality
                dimScores[i * 3 + 2]    // Analysis Depth
            );
        }

        // Track epoch work
        _epochWork[studio][epoch].push(resolutionHash);

        emit ResolutionCompleted(studio, epoch, resolution, totalDistributed, workers.length);
    }
```

#### A5. Add _getAgentReputation helper (after resolveAndDistribute)

```solidity
    /**
     * @notice Get agent reputation score, defaulting to 50 if none exists
     * @param agentId The agent ID
     * @return reputation Score 0-100 (50 = neutral default)
     */
    function _getAgentReputation(uint256 agentId) internal view returns (uint256) {
        address reputationRegistryAddr = registry.getReputationRegistry();
        if (reputationRegistryAddr == address(0)) return 50;

        uint256 size;
        assembly {
            size := extcodesize(reputationRegistryAddr)
        }
        if (size == 0) return 50;

        // Query reputation: filter by this contract as clientAddress
        address[] memory clients = new address[](1);
        clients[0] = address(this);

        try IERC8004Reputation(reputationRegistryAddr).getSummary(
            agentId,
            clients,
            "RESOLUTION_QUALITY",
            ""
        ) returns (uint64 count, int128 summaryValue, uint8 /* decimals */) {
            if (count == 0) return 50; // No history → neutral
            if (summaryValue < 0) return 10; // Negative rep → minimum
            if (summaryValue > 100) return 100; // Cap at 100
            return uint256(uint128(summaryValue));
        } catch {
            return 50; // Fallback → neutral
        }
    }
```

#### A6. Add _publishResolutionReputation helper — 3 dimensions, no accuracy tag (after _getAgentReputation)

Option 4: Publishes 3 custom dimensions without revealing whether the worker voted accurately.
The accuracy is already baked into the pre-computed weights by CRE off-chain.

```solidity
    /**
     * @notice Publish 3-dimensional resolution reputation for a worker oracle (Option 4: Blinded)
     * @dev Publishes Resolution Quality, Source Quality, and Analysis Depth
     *      WITHOUT accuracy tag — individual votes stay confidential in CRE TEE.
     * @param agentId The agent's ERC-8004 identity ID
     * @param resolutionQuality How thorough was the investigation (0-100)
     * @param sourceQuality How credible were the sources (0-100)
     * @param analysisDepth How deep was the analysis (0-100)
     */
    function _publishResolutionReputation(
        uint256 agentId,
        uint8 resolutionQuality,
        uint8 sourceQuality,
        uint8 analysisDepth
    ) internal {
        address reputationRegistryAddr = registry.getReputationRegistry();
        if (reputationRegistryAddr == address(0)) return;

        uint256 size;
        assembly { size := extcodesize(reputationRegistryAddr) }
        if (size == 0) return;

        IERC8004Reputation rep = IERC8004Reputation(reputationRegistryAddr);

        // Dimension 1: Resolution Quality (weight 250 in getScoringCriteria)
        try rep.giveFeedback(
            agentId, int128(uint128(resolutionQuality)), 0,
            "RESOLUTION_QUALITY", "", "", "", bytes32(0)
        ) {} catch {}

        // Dimension 2: Source Quality (weight 200)
        try rep.giveFeedback(
            agentId, int128(uint128(sourceQuality)), 0,
            "SOURCE_QUALITY", "", "", "", bytes32(0)
        ) {} catch {}

        // Dimension 3: Analysis Depth (weight 150)
        try rep.giveFeedback(
            agentId, int128(uint128(analysisDepth)), 0,
            "ANALYSIS_DEPTH", "", "", "", bytes32(0)
        ) {} catch {}
    }
```

---

### B. ResolutionMarketLogic.sol — New File

**File**: `packages/contracts/src/logic/ResolutionMarketLogic.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LogicModule} from "../base/LogicModule.sol";

/**
 * @title ResolutionMarketLogic
 * @notice LogicModule for ChaosSettler prediction market resolution Studios
 * @dev Worker Agents are AI oracles that investigate and determine outcomes.
 *      CRE DON orchestrates the resolution workflow off-chain, then calls
 *      RewardsDistributor.resolveAndDistribute() to settle on-chain.
 *
 * @author ChaosSettler / ChaosChain Labs
 */
contract ResolutionMarketLogic is LogicModule {

    // ============ Custom Storage ============

    struct Market {
        string question;
        uint256 rewardPool;
        uint256 deadline;
        address creator;
        bool active;
        bool resolved;
    }

    /// @dev marketId => Market
    mapping(bytes32 => Market) private _markets;

    /// @dev Market count
    uint256 private _marketCount;

    // ============ Events ============

    event MarketCreated(
        bytes32 indexed marketId,
        string question,
        uint256 rewardPool,
        uint256 deadline,
        address indexed creator
    );

    event MarketResolved(bytes32 indexed marketId, bool resolution);

    // ============ Implementation ============

    /// @inheritdoc LogicModule
    function initialize(bytes calldata /* params */) external override {
        // No initialization needed
    }

    /**
     * @notice Create a new resolution market
     * @param question The question to resolve (e.g., "Will SEC approve Solana ETF by 2026?")
     * @param rewardPool Amount of ETH to allocate as rewards
     * @param duration Duration in seconds until resolution deadline
     * @return marketId The market identifier
     */
    function createMarket(
        string calldata question,
        uint256 rewardPool,
        uint256 duration
    ) external hasEscrow(rewardPool) returns (bytes32 marketId) {
        require(bytes(question).length > 0, "Empty question");
        require(rewardPool > 0, "Invalid reward pool");
        require(duration > 0 && duration <= 90 days, "Invalid duration");

        marketId = keccak256(abi.encodePacked(
            block.timestamp,
            msg.sender,
            _marketCount++
        ));

        _deductEscrow(msg.sender, rewardPool);

        _markets[marketId] = Market({
            question: question,
            rewardPool: rewardPool,
            deadline: block.timestamp + duration,
            creator: msg.sender,
            active: true,
            resolved: false
        });

        emit MarketCreated(marketId, question, rewardPool, block.timestamp + duration, msg.sender);
        emit LogicExecuted("createMarket", msg.sender, abi.encode(marketId));
    }

    /**
     * @notice Get market details
     * @param marketId The market ID
     * @return market The market struct
     */
    function getMarket(bytes32 marketId) external view returns (Market memory market) {
        return _markets[marketId];
    }

    /**
     * @notice Check if a market is active (not resolved, not expired)
     * @param marketId The market ID
     * @return active True if market is active
     */
    function isMarketActive(bytes32 marketId) external view returns (bool active) {
        Market storage market = _markets[marketId];
        return market.active && !market.resolved && block.timestamp < market.deadline;
    }

    // ============ LogicModule Overrides ============

    /// @inheritdoc LogicModule
    function getStudioType() external pure override returns (string memory studioType) {
        return "ResolutionMarket";
    }

    /// @inheritdoc LogicModule
    function getVersion() external pure override returns (string memory version) {
        return "1.0.0";
    }

    /// @inheritdoc LogicModule
    function getScoringCriteria() external pure override returns (
        string[] memory names,
        uint16[] memory weights
    ) {
        // Total: 5 universal PoA + 3 resolution-specific = 8 dimensions
        names = new string[](8);
        weights = new uint16[](8);

        // Universal PoA dimensions (REQUIRED)
        names[0] = "Initiative";
        names[1] = "Collaboration";
        names[2] = "Reasoning Depth";
        names[3] = "Compliance";
        names[4] = "Efficiency";

        // Resolution market-specific dimensions
        names[5] = "Resolution Quality";  // How thorough was the investigation?
        names[6] = "Source Quality";       // How credible were the sources?
        names[7] = "Reasoning Depth";      // How deep was the analysis?

        // Weights (100 = 1.0x baseline)
        weights[0] = 100;  // Initiative: 1.0x
        weights[1] = 100;  // Collaboration: 1.0x
        weights[2] = 100;  // Reasoning Depth: 1.0x
        weights[3] = 100;  // Compliance: 1.0x
        weights[4] = 100;  // Efficiency: 1.0x
        weights[5] = 250;  // Resolution Quality: 2.5x (MOST CRITICAL)
        weights[6] = 200;  // Source Quality: 2.0x
        weights[7] = 150;  // Reasoning Depth: 1.5x
    }
}
```

---

### C. CREReceiver.sol — New File (Chainlink CRE Bridge)

**File**: `packages/contracts/src/CREReceiver.sol`

This contract implements Chainlink's `IReceiver` interface and bridges CRE DON reports
to `RewardsDistributor.resolveAndDistribute()`. KeystoneForwarder calls `onReport()`,
which decodes the payload and forwards it.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IReceiver {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

interface IRewardsDistributor {
    function resolveAndDistribute(
        address studio,
        uint64 epoch,
        address[] calldata workers,
        uint256[] calldata weights,
        uint8[] calldata dimScores,
        bool resolution
    ) external;
}

/**
 * @title CREReceiver
 * @notice Receives DON-signed reports from KeystoneForwarder and forwards
 *         resolution data to RewardsDistributor.resolveAndDistribute()
 * @dev Deploy this, then call rewardsDistributor.setAuthorizedResolver(address(this), true)
 *
 * @author ChaosSettler / ChaosChain Labs
 */
contract CREReceiver is IReceiver, Ownable {
    IRewardsDistributor public immutable rewardsDistributor;
    address public keystoneForwarder;

    event ReportReceived(bytes32 indexed workflowId, address indexed studio, uint64 epoch);
    event ForwarderUpdated(address indexed oldForwarder, address indexed newForwarder);

    error UnauthorizedForwarder(address caller);

    constructor(
        address _rewardsDistributor,
        address _keystoneForwarder
    ) Ownable(msg.sender) {
        rewardsDistributor = IRewardsDistributor(_rewardsDistributor);
        keystoneForwarder = _keystoneForwarder;
    }

    /**
     * @notice Update the KeystoneForwarder address
     * @param _newForwarder The new forwarder address
     */
    function setKeystoneForwarder(address _newForwarder) external onlyOwner {
        address old = keystoneForwarder;
        keystoneForwarder = _newForwarder;
        emit ForwarderUpdated(old, _newForwarder);
    }

    /**
     * @notice Called by KeystoneForwarder with a DON-signed report
     * @param metadata CRE metadata (workflow ID, DON ID, etc.)
     * @param report ABI-encoded resolution payload
     */
    function onReport(bytes calldata metadata, bytes calldata report) external override {
        if (msg.sender != keystoneForwarder) {
            revert UnauthorizedForwarder(msg.sender);
        }

        // Decode the resolution payload (Option 4: blinded weights)
        (
            address studio,
            uint64 epoch,
            address[] memory workers,
            uint256[] memory weights,
            uint8[] memory dimScores,
            bool resolution
        ) = abi.decode(report, (address, uint64, address[], uint256[], uint8[], bool));

        // Forward to RewardsDistributor
        rewardsDistributor.resolveAndDistribute(
            studio,
            epoch,
            workers,
            weights,
            dimScores,
            resolution
        );

        // Extract workflow ID from metadata for logging
        bytes32 workflowId;
        if (metadata.length >= 32) {
            workflowId = bytes32(metadata[:32]);
        }

        emit ReportReceived(workflowId, studio, epoch);
    }
}
```

---

### D. CREReceiver.t.sol — New Test File

**File**: `packages/contracts/test/CREReceiver.t.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {CREReceiver} from "../src/CREReceiver.sol";
import {ChaosChainRegistry} from "../src/ChaosChainRegistry.sol";
import {ChaosCore} from "../src/ChaosCore.sol";
import {StudioProxy} from "../src/StudioProxy.sol";
import {StudioProxyFactory} from "../src/StudioProxyFactory.sol";
import {RewardsDistributor} from "../src/RewardsDistributor.sol";
import {ResolutionMarketLogic} from "../src/logic/ResolutionMarketLogic.sol";

import {
    MockIdentityRegistryIntegration,
    MockReputationRegistryIntegration
} from "./integration/CloseEpoch.integration.t.sol";

/**
 * @title CREReceiverTest
 * @notice Tests for the CREReceiver (Chainlink CRE bridge)
 */
contract CREReceiverTest is Test {

    ChaosChainRegistry public registry;
    ChaosCore public chaosCore;
    RewardsDistributor public rewardsDistributor;
    StudioProxyFactory public factory;
    ResolutionMarketLogic public resolutionLogic;
    MockIdentityRegistryIntegration public mockIdentity;
    MockReputationRegistryIntegration public mockReputation;
    CREReceiver public creReceiver;

    address public owner;
    address public keystoneForwarder;
    address public studioOwner;
    address public workerA;
    address public workerB;
    address public studioProxy;

    uint256 public agentIdA;
    uint256 public agentIdB;

    event ReportReceived(bytes32 indexed workflowId, address indexed studio, uint64 epoch);

    function setUp() public {
        owner = address(this);
        keystoneForwarder = makeAddr("keystoneForwarder");
        studioOwner = makeAddr("studioOwner");
        workerA = makeAddr("workerA");
        workerB = makeAddr("workerB");

        // Deploy mocks
        mockIdentity = new MockIdentityRegistryIntegration();
        mockReputation = new MockReputationRegistryIntegration();

        vm.prank(workerA);
        agentIdA = mockIdentity.register();
        vm.prank(workerB);
        agentIdB = mockIdentity.register();

        // Deploy infrastructure
        registry = new ChaosChainRegistry(
            address(mockIdentity), address(mockReputation), address(0x1003)
        );
        rewardsDistributor = new RewardsDistributor(address(registry));
        factory = new StudioProxyFactory();
        chaosCore = new ChaosCore(address(registry), address(factory));
        resolutionLogic = new ResolutionMarketLogic();

        registry.setChaosCore(address(chaosCore));
        registry.setRewardsDistributor(address(rewardsDistributor));
        chaosCore.registerLogicModule(address(resolutionLogic), "ResolutionMarket");

        // Deploy CREReceiver
        creReceiver = new CREReceiver(
            address(rewardsDistributor),
            keystoneForwarder
        );

        // Authorize CREReceiver (NOT the forwarder!)
        rewardsDistributor.setAuthorizedResolver(address(creReceiver), true);

        // Setup studio
        vm.deal(studioOwner, 100 ether);
        vm.deal(workerA, 10 ether);
        vm.deal(workerB, 10 ether);

        vm.prank(studioOwner);
        (studioProxy, ) = chaosCore.createStudio("CRE Test", address(resolutionLogic));

        vm.prank(workerA);
        StudioProxy(payable(studioProxy)).registerAgent{value: 0.01 ether}(
            agentIdA, StudioProxy.AgentRole.WORKER
        );
        vm.prank(workerB);
        StudioProxy(payable(studioProxy)).registerAgent{value: 0.01 ether}(
            agentIdB, StudioProxy.AgentRole.WORKER
        );

        vm.prank(studioOwner);
        StudioProxy(payable(studioProxy)).deposit{value: 1 ether}();
    }

    function _buildReport(
        uint256 weightA,
        uint256 weightB,
        uint8[3] memory dimsA,
        uint8[3] memory dimsB,
        bool resolution
    ) internal view returns (bytes memory) {
        address[] memory workers = new address[](2);
        workers[0] = workerA;
        workers[1] = workerB;

        uint256[] memory weights = new uint256[](2);
        weights[0] = weightA;
        weights[1] = weightB;

        // Flat dimScores: [w0_resQuality, w0_srcQuality, w0_analysis, w1_...]
        uint8[] memory dimScores = new uint8[](6);
        dimScores[0] = dimsA[0]; dimScores[1] = dimsA[1]; dimScores[2] = dimsA[2];
        dimScores[3] = dimsB[0]; dimScores[4] = dimsB[1]; dimScores[5] = dimsB[2];

        return abi.encode(studioProxy, uint64(1), workers, weights, dimScores, resolution);
    }

    function test_onReport_happy_path() public {
        bytes memory metadata = abi.encode(bytes32("workflow-001"));
        // Worker A: high weight (accurate, quality=90), Worker B: low weight (inaccurate, quality=40)
        bytes memory report = _buildReport(
            900000, 100000,                     // weights (pre-computed by CRE)
            [uint8(90), uint8(85), uint8(80)],  // A dims: resQuality, srcQuality, analysis
            [uint8(40), uint8(35), uint8(30)],  // B dims
            true
        );

        vm.prank(keystoneForwarder);
        creReceiver.onReport(metadata, report);

        // Verify funds were distributed
        uint256 balanceA = StudioProxy(payable(studioProxy)).getWithdrawableBalance(workerA);
        assertGt(balanceA, 0, "Worker A should have withdrawable balance");
    }

    function test_onReport_reverts_unauthorized_caller() public {
        bytes memory metadata = abi.encode(bytes32("workflow-001"));
        bytes memory report = _buildReport(
            900000, 100000,
            [uint8(90), uint8(85), uint8(80)],
            [uint8(40), uint8(35), uint8(30)],
            true
        );

        address randomCaller = makeAddr("random");
        vm.prank(randomCaller);
        vm.expectRevert(abi.encodeWithSelector(
            CREReceiver.UnauthorizedForwarder.selector,
            randomCaller
        ));
        creReceiver.onReport(metadata, report);
    }

    function test_onReport_emits_event() public {
        bytes32 workflowId = bytes32("workflow-002");
        bytes memory metadata = abi.encode(workflowId);
        bytes memory report = _buildReport(80, 80, true, true, true);

        vm.prank(keystoneForwarder);
        vm.expectEmit(true, true, false, false);
        emit ReportReceived(workflowId, studioProxy, 1);
        creReceiver.onReport(metadata, report);
    }

    function test_setKeystoneForwarder_only_owner() public {
        address newForwarder = makeAddr("newForwarder");

        // Owner can update
        creReceiver.setKeystoneForwarder(newForwarder);
        assertEq(creReceiver.keystoneForwarder(), newForwarder);

        // Non-owner cannot
        vm.prank(workerA);
        vm.expectRevert();
        creReceiver.setKeystoneForwarder(makeAddr("another"));
    }

    function test_onReport_with_updated_forwarder() public {
        address newForwarder = makeAddr("newForwarder");
        creReceiver.setKeystoneForwarder(newForwarder);

        bytes memory metadata = abi.encode(bytes32("workflow-003"));
        bytes memory report = _buildReport(70, 70, true, false, true);

        // Old forwarder should fail
        vm.prank(keystoneForwarder);
        vm.expectRevert();
        creReceiver.onReport(metadata, report);

        // New forwarder should work
        vm.prank(newForwarder);
        creReceiver.onReport(metadata, report);
    }
}
```

---

### E. ResolveAndDistribute.t.sol — New Test File

**File**: `packages/contracts/test/ResolveAndDistribute.t.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {ChaosChainRegistry} from "../src/ChaosChainRegistry.sol";
import {ChaosCore} from "../src/ChaosCore.sol";
import {StudioProxy} from "../src/StudioProxy.sol";
import {StudioProxyFactory} from "../src/StudioProxyFactory.sol";
import {RewardsDistributor} from "../src/RewardsDistributor.sol";
import {ResolutionMarketLogic} from "../src/logic/ResolutionMarketLogic.sol";
import {IERC8004IdentityV1} from "../src/interfaces/IERC8004IdentityV1.sol";
import {IERC8004Reputation} from "../src/interfaces/IERC8004Reputation.sol";

// Reuse the mocks from CloseEpoch integration tests
import {
    MockIdentityRegistryIntegration,
    MockReputationRegistryIntegration
} from "./integration/CloseEpoch.integration.t.sol";

/**
 * @title ResolveAndDistributeTest
 * @notice Tests for RewardsDistributor.resolveAndDistribute()
 * @dev Tests the ChaosSettler resolution flow
 */
contract ResolveAndDistributeTest is Test {

    // ============ Contracts ============
    ChaosChainRegistry public registry;
    ChaosCore public chaosCore;
    RewardsDistributor public rewardsDistributor;
    StudioProxyFactory public factory;
    ResolutionMarketLogic public resolutionLogic;
    MockIdentityRegistryIntegration public mockIdentity;
    MockReputationRegistryIntegration public mockReputation;

    // ============ Actors ============
    address public owner;
    address public studioOwner;
    address public workerA;
    address public workerB;
    address public workerC;
    address public creDon; // Simulated CRE DON address

    // ============ Agent IDs ============
    uint256 public agentIdA;
    uint256 public agentIdB;
    uint256 public agentIdC;

    // ============ Studio ============
    address public studioProxy;

    // ============ Events ============
    event ResolutionCompleted(
        address indexed studio, uint64 indexed epoch,
        bool resolution, uint256 totalDistributed, uint256 workerCount
    );
    event ResolverUpdated(address indexed resolver, bool authorized);
    event FundsReleased(address indexed recipient, uint256 amount, bytes32 dataHash);

    function setUp() public {
        owner = address(this);
        studioOwner = makeAddr("studioOwner");
        workerA = makeAddr("workerA");
        workerB = makeAddr("workerB");
        workerC = makeAddr("workerC");
        creDon = makeAddr("creDon");

        // Deploy mocks
        mockIdentity = new MockIdentityRegistryIntegration();
        mockReputation = new MockReputationRegistryIntegration();

        // Register agent identities
        vm.prank(workerA);
        agentIdA = mockIdentity.register();
        vm.prank(workerB);
        agentIdB = mockIdentity.register();
        vm.prank(workerC);
        agentIdC = mockIdentity.register();

        // Deploy infrastructure
        registry = new ChaosChainRegistry(
            address(mockIdentity),
            address(mockReputation),
            address(0x1003) // validation registry placeholder
        );
        rewardsDistributor = new RewardsDistributor(address(registry));
        factory = new StudioProxyFactory();
        chaosCore = new ChaosCore(address(registry), address(factory));
        resolutionLogic = new ResolutionMarketLogic();

        // Wire up
        registry.setChaosCore(address(chaosCore));
        registry.setRewardsDistributor(address(rewardsDistributor));
        chaosCore.registerLogicModule(address(resolutionLogic), "ResolutionMarket");

        // Authorize CRE DON
        rewardsDistributor.setAuthorizedResolver(creDon, true);

        // Fund actors
        vm.deal(studioOwner, 100 ether);
        vm.deal(workerA, 10 ether);
        vm.deal(workerB, 10 ether);
        vm.deal(workerC, 10 ether);

        // Create Studio
        vm.prank(studioOwner);
        (studioProxy, ) = chaosCore.createStudio("ChaosSettler Test", address(resolutionLogic));

        // Register 2 workers with stake
        vm.prank(workerA);
        StudioProxy(payable(studioProxy)).registerAgent{value: 0.01 ether}(
            agentIdA, StudioProxy.AgentRole.WORKER
        );
        vm.prank(workerB);
        StudioProxy(payable(studioProxy)).registerAgent{value: 0.01 ether}(
            agentIdB, StudioProxy.AgentRole.WORKER
        );

        // Deposit reward pool
        vm.prank(studioOwner);
        StudioProxy(payable(studioProxy)).deposit{value: 1 ether}();
    }

    // ============ Helper (Option 4: blinded weights) ============

    function _twoWorkerResolve(
        uint256 weightA,
        uint256 weightB,
        uint8[3] memory dimsA,
        uint8[3] memory dimsB,
        bool resolution
    ) internal {
        address[] memory workers = new address[](2);
        workers[0] = workerA;
        workers[1] = workerB;

        uint256[] memory weights = new uint256[](2);
        weights[0] = weightA;
        weights[1] = weightB;

        uint8[] memory dimScores = new uint8[](6);
        dimScores[0] = dimsA[0]; dimScores[1] = dimsA[1]; dimScores[2] = dimsA[2];
        dimScores[3] = dimsB[0]; dimScores[4] = dimsB[1]; dimScores[5] = dimsB[2];

        vm.prank(creDon);
        rewardsDistributor.resolveAndDistribute(
            studioProxy, 1, workers, weights, dimScores, resolution
        );
    }

    // ============ Tests ============

    function test_resolveAndDistribute_happy_path() public {
        // Worker A: high weight (accurate + high quality), Worker B: low weight
        // CRE pre-computed: A=90*200*50=900000, B=40*50*50=100000

        uint256 balanceBefore = StudioProxy(payable(studioProxy)).getWithdrawableBalance(workerA);

        _twoWorkerResolve(
            900000, 100000,
            [uint8(90), uint8(85), uint8(80)],
            [uint8(40), uint8(35), uint8(30)],
            true
        );

        // Worker A should have more rewards (higher pre-computed weight)
        uint256 balanceA = StudioProxy(payable(studioProxy)).getWithdrawableBalance(workerA);
        uint256 balanceB = StudioProxy(payable(studioProxy)).getWithdrawableBalance(workerB);

        assertGt(balanceA, balanceBefore, "Worker A must receive rewards");
        assertGt(balanceA, balanceB, "Higher-weight worker gets more");
        assertGt(balanceB, 0, "Lower-weight worker still gets something");

        console.log("Worker A withdrawable:", balanceA);
        console.log("Worker B withdrawable:", balanceB);
    }

    function test_resolveAndDistribute_all_agree() public {
        // Both workers accurate, different quality → different weights
        // CRE: A=90*200*50=900000, B=80*200*50=800000
        _twoWorkerResolve(
            900000, 800000,
            [uint8(90), uint8(85), uint8(80)],
            [uint8(80), uint8(75), uint8(70)],
            true
        );

        uint256 balanceA = StudioProxy(payable(studioProxy)).getWithdrawableBalance(workerA);
        uint256 balanceB = StudioProxy(payable(studioProxy)).getWithdrawableBalance(workerB);

        assertGt(balanceA, balanceB, "Higher weight gets more");
        assertGt(balanceB, 0, "Both receive rewards");
    }

    function test_resolveAndDistribute_split_decision() public {
        // Same quality=70, but A accurate (200x), B inaccurate (50x)
        // CRE: A=70*200*50=700000, B=70*50*50=175000
        _twoWorkerResolve(
            700000, 175000,
            [uint8(70), uint8(65), uint8(60)],
            [uint8(70), uint8(65), uint8(60)],
            true
        );

        uint256 balanceA = StudioProxy(payable(studioProxy)).getWithdrawableBalance(workerA);
        uint256 balanceB = StudioProxy(payable(studioProxy)).getWithdrawableBalance(workerB);

        // A gets ~4x weight → ~4x reward
        assertGt(balanceA, balanceB, "Accurate oracle gets ~4x weight");
    }

    function test_resolveAndDistribute_reverts_unauthorized() public {
        address unauthorized = makeAddr("unauthorized");
        address[] memory workers = new address[](1);
        workers[0] = workerA;
        uint256[] memory weights = new uint256[](1);
        weights[0] = 500000;
        uint8[] memory dimScores = new uint8[](3);
        dimScores[0] = 80; dimScores[1] = 75; dimScores[2] = 70;

        vm.prank(unauthorized);
        vm.expectRevert("Not authorised resolver");
        rewardsDistributor.resolveAndDistribute(
            studioProxy, 1, workers, weights, dimScores, true
        );
    }

    function test_resolveAndDistribute_reverts_no_workers() public {
        address[] memory workers = new address[](0);
        uint256[] memory weights = new uint256[](0);
        uint8[] memory dimScores = new uint8[](0);

        vm.prank(creDon);
        vm.expectRevert("No workers");
        rewardsDistributor.resolveAndDistribute(
            studioProxy, 1, workers, weights, dimScores, true
        );
    }

    function test_resolveAndDistribute_reverts_array_mismatch() public {
        address[] memory workers = new address[](2);
        workers[0] = workerA;
        workers[1] = workerB;
        uint256[] memory weights = new uint256[](1); // mismatch!
        weights[0] = 500000;
        uint8[] memory dimScores = new uint8[](6);

        vm.prank(creDon);
        vm.expectRevert("Array length mismatch");
        rewardsDistributor.resolveAndDistribute(
            studioProxy, 1, workers, weights, dimScores, true
        );
    }

    function test_resolveAndDistribute_returns_stakes() public {
        // After resolution, workers should have stake + reward in withdrawable
        _twoWorkerResolve(
            800000, 800000,
            [uint8(80), uint8(75), uint8(70)],
            [uint8(80), uint8(75), uint8(70)],
            true
        );

        uint256 balanceA = StudioProxy(payable(studioProxy)).getWithdrawableBalance(workerA);

        // Balance should be > stake (0.01 ether) because it includes reward
        assertGt(balanceA, 0.01 ether, "Balance includes stake + reward");
    }

    function test_resolveAndDistribute_publishes_reputation() public {
        mockReputation.resetCallCount();

        _twoWorkerResolve(
            900000, 100000,
            [uint8(90), uint8(85), uint8(80)],
            [uint8(40), uint8(35), uint8(30)],
            true
        );

        // Should call giveFeedback 3 times per worker (3 dims × 2 workers = 6)
        assertGe(
            mockReputation.giveFeedbackCallCount(),
            6,
            "giveFeedback called 3 dims per worker"
        );
    }

    function test_resolveAndDistribute_epoch_tracked() public {
        _twoWorkerResolve(
            800000, 800000,
            [uint8(80), uint8(75), uint8(70)],
            [uint8(80), uint8(75), uint8(70)],
            true
        );

        bytes32[] memory epochWork = rewardsDistributor.getEpochWork(studioProxy, 1);
        assertEq(epochWork.length, 1, "Epoch work tracked");
        assertNotEq(epochWork[0], bytes32(0), "Valid hash stored");
    }

    function test_setAuthorizedResolver_only_owner() public {
        address newResolver = makeAddr("newResolver");

        // Should work from owner
        rewardsDistributor.setAuthorizedResolver(newResolver, true);
        assertTrue(rewardsDistributor.authorizedResolvers(newResolver));

        // Should revert from non-owner
        vm.prank(workerA);
        vm.expectRevert();
        rewardsDistributor.setAuthorizedResolver(newResolver, false);
    }

    function test_setAuthorizedResolver_reverts_zero_address() public {
        vm.expectRevert("Invalid Resolver");
        rewardsDistributor.setAuthorizedResolver(address(0), true);
    }

    function test_resolveAndDistribute_owner_can_call() public {
        // Owner should also be able to call (not just authorized resolvers)
        address[] memory workers = new address[](1);
        workers[0] = workerA;
        uint256[] memory weights = new uint256[](1);
        weights[0] = 500000;
        uint8[] memory dimScores = new uint8[](3);
        dimScores[0] = 80; dimScores[1] = 75; dimScores[2] = 70;

        // Called by owner (this contract), not creDon
        rewardsDistributor.resolveAndDistribute(
            studioProxy, 1, workers, weights, dimScores, true
        );

        uint256 balance = StudioProxy(payable(studioProxy)).getWithdrawableBalance(workerA);
        assertGt(balance, 0, "Owner can call resolveAndDistribute");
    }
}
```

---

### F. ResolutionMarketLogic.t.sol — New Test File

**File**: `packages/contracts/test/ResolutionMarketLogic.t.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {ChaosChainRegistry} from "../src/ChaosChainRegistry.sol";
import {ChaosCore} from "../src/ChaosCore.sol";
import {StudioProxy} from "../src/StudioProxy.sol";
import {StudioProxyFactory} from "../src/StudioProxyFactory.sol";
import {RewardsDistributor} from "../src/RewardsDistributor.sol";
import {ResolutionMarketLogic} from "../src/logic/ResolutionMarketLogic.sol";

import {
    MockIdentityRegistryIntegration,
    MockReputationRegistryIntegration
} from "./integration/CloseEpoch.integration.t.sol";

/**
 * @title ResolutionMarketLogicTest
 * @notice Tests for the ResolutionMarketLogic module
 */
contract ResolutionMarketLogicTest is Test {

    ChaosChainRegistry public registry;
    ChaosCore public chaosCore;
    RewardsDistributor public rewardsDistributor;
    StudioProxyFactory public factory;
    ResolutionMarketLogic public resolutionLogic;
    MockIdentityRegistryIntegration public mockIdentity;
    MockReputationRegistryIntegration public mockReputation;

    address public studioOwner;
    address public studioProxy;

    function setUp() public {
        studioOwner = makeAddr("studioOwner");

        mockIdentity = new MockIdentityRegistryIntegration();
        mockReputation = new MockReputationRegistryIntegration();

        registry = new ChaosChainRegistry(
            address(mockIdentity),
            address(mockReputation),
            address(0x1003)
        );
        rewardsDistributor = new RewardsDistributor(address(registry));
        factory = new StudioProxyFactory();
        chaosCore = new ChaosCore(address(registry), address(factory));
        resolutionLogic = new ResolutionMarketLogic();

        registry.setChaosCore(address(chaosCore));
        registry.setRewardsDistributor(address(rewardsDistributor));
        chaosCore.registerLogicModule(address(resolutionLogic), "ResolutionMarket");

        vm.deal(studioOwner, 100 ether);

        vm.prank(studioOwner);
        (studioProxy, ) = chaosCore.createStudio("Resolution Studio", address(resolutionLogic));

        vm.prank(studioOwner);
        StudioProxy(payable(studioProxy)).deposit{value: 10 ether}();
    }

    function test_getStudioType() public view {
        assertEq(resolutionLogic.getStudioType(), "ResolutionMarket");
    }

    function test_getVersion() public view {
        assertEq(resolutionLogic.getVersion(), "1.0.0");
    }

    function test_getScoringCriteria() public view {
        (string[] memory names, uint16[] memory weights) = resolutionLogic.getScoringCriteria();

        assertEq(names.length, 8, "8 dimensions total");
        assertEq(weights.length, 8, "8 weights total");

        // Universal PoA
        assertEq(names[0], "Initiative");
        assertEq(names[4], "Efficiency");

        // Custom resolution dimensions
        assertEq(names[5], "Resolution Quality");
        assertEq(names[6], "Source Quality");

        // Weights
        assertEq(weights[5], 250, "Resolution Quality is 2.5x");
        assertEq(weights[6], 200, "Source Quality is 2.0x");
    }

    function test_createMarket() public {
        vm.prank(studioOwner);
        bytes32 marketId = ResolutionMarketLogic(studioProxy).createMarket(
            "Will SEC approve Solana ETF by 2026?",
            1 ether,
            7 days
        );

        assertNotEq(marketId, bytes32(0), "Market created");

        ResolutionMarketLogic.Market memory market = ResolutionMarketLogic(studioProxy).getMarket(marketId);
        assertEq(market.question, "Will SEC approve Solana ETF by 2026?");
        assertEq(market.rewardPool, 1 ether);
        assertTrue(market.active);
        assertFalse(market.resolved);
    }

    function test_isMarketActive() public {
        vm.prank(studioOwner);
        bytes32 marketId = ResolutionMarketLogic(studioProxy).createMarket(
            "Test market",
            1 ether,
            1 days
        );

        assertTrue(ResolutionMarketLogic(studioProxy).isMarketActive(marketId));

        // Warp past deadline
        vm.warp(block.timestamp + 2 days);
        assertFalse(ResolutionMarketLogic(studioProxy).isMarketActive(marketId));
    }

    function test_createMarket_reverts_empty_question() public {
        vm.prank(studioOwner);
        vm.expectRevert("Empty question");
        ResolutionMarketLogic(studioProxy).createMarket("", 1 ether, 7 days);
    }

    function test_createMarket_reverts_insufficient_escrow() public {
        vm.prank(studioOwner);
        vm.expectRevert("Insufficient escrow");
        ResolutionMarketLogic(studioProxy).createMarket(
            "Test?", 999 ether, 7 days // More than deposited
        );
    }
}
```

---

### G. DeployChaosSettler.s.sol — Deploy Script

**File**: `packages/contracts/script/DeployChaosSettler.s.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ChaosChainRegistry} from "../src/ChaosChainRegistry.sol";
import {ChaosCore} from "../src/ChaosCore.sol";
import {StudioProxyFactory} from "../src/StudioProxyFactory.sol";
import {RewardsDistributor} from "../src/RewardsDistributor.sol";
import {ResolutionMarketLogic} from "../src/logic/ResolutionMarketLogic.sol";
import {CREReceiver} from "../src/CREReceiver.sol";

/**
 * @title DeployChaosSettler
 * @notice Deploy ChaosSettler on Anvil or testnet
 *
 * Usage (Anvil):
 *   anvil --port 8546
 *   forge script script/DeployChaosSettler.s.sol --rpc-url http://localhost:8546 --broadcast
 *
 * Usage (Base Sepolia):
 *   forge script script/DeployChaosSettler.s.sol --rpc-url base_sepolia --broadcast --verify
 */
contract DeployChaosSettler is Script {

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Optional: use existing ERC-8004 registries or deploy mocks
        address identityRegistry = vm.envOr("IDENTITY_REGISTRY", address(0));
        address reputationRegistry = vm.envOr("REPUTATION_REGISTRY", address(0));
        address validationRegistry = vm.envOr("VALIDATION_REGISTRY", address(0));

        // KeystoneForwarder address
        // Base Sepolia CRE Simulation: 0x82300bd7c3958625581cc2f77bc6464dcecdf3e5
        address keystoneForwarder = vm.envOr(
            "KEYSTONE_FORWARDER",
            address(0x82300bd7c3958625581cc2f77bc6464dcecdf3e5)
        );

        // Optional: direct CRE DON signer (for local demo without CRE)
        address creDonSigner = vm.envOr("CRE_DON_ADDRESS", address(0));

        // Reward pool deposit amount
        uint256 rewardDeposit = vm.envOr("REWARD_DEPOSIT", uint256(1 ether));

        console.log("=== ChaosSettler Deployment ===");
        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy Registry
        ChaosChainRegistry registry = new ChaosChainRegistry(
            identityRegistry,
            reputationRegistry,
            validationRegistry
        );
        console.log("Registry:", address(registry));

        // 2. Deploy RewardsDistributor
        RewardsDistributor rewardsDistributor = new RewardsDistributor(address(registry));
        console.log("RewardsDistributor:", address(rewardsDistributor));

        // 3. Deploy Factory + ChaosCore
        StudioProxyFactory factoryContract = new StudioProxyFactory();
        ChaosCore chaosCore = new ChaosCore(address(registry), address(factoryContract));
        console.log("ChaosCore:", address(chaosCore));

        // 4. Wire up registry
        registry.setChaosCore(address(chaosCore));
        registry.setRewardsDistributor(address(rewardsDistributor));

        // 5. Deploy and register ResolutionMarketLogic
        ResolutionMarketLogic resolutionLogic = new ResolutionMarketLogic();
        chaosCore.registerLogicModule(address(resolutionLogic), "ResolutionMarket");
        console.log("ResolutionMarketLogic:", address(resolutionLogic));

        // 6. Deploy CREReceiver and authorize it
        CREReceiver creReceiver = new CREReceiver(
            address(rewardsDistributor),
            keystoneForwarder
        );
        rewardsDistributor.setAuthorizedResolver(address(creReceiver), true);
        console.log("CREReceiver:", address(creReceiver));
        console.log("KeystoneForwarder:", keystoneForwarder);

        // 7. Optionally authorize a direct signer (for local demo without CRE)
        if (creDonSigner != address(0)) {
            rewardsDistributor.setAuthorizedResolver(creDonSigner, true);
            console.log("Authorized direct signer:", creDonSigner);
        }

        // 8. Create Studio
        (address proxy, uint256 studioId) = chaosCore.createStudio(
            "ChaosSettler",
            address(resolutionLogic)
        );
        console.log("StudioProxy:", proxy);
        console.log("StudioId:", studioId);

        // 9. Deposit reward pool
        if (rewardDeposit > 0) {
            (bool success, ) = proxy.call{value: rewardDeposit}(
                abi.encodeWithSignature("deposit()")
            );
            require(success, "Deposit failed");
            console.log("Deposited:", rewardDeposit);
        }

        vm.stopBroadcast();

        console.log("");
        console.log("=== Deployment Complete ===");
        console.log("Next: register workers, create markets, run CRE workflow");
    }
}
```

---

## PART 2: CHAOSSETTLER REPO (NEW)

---

### Root Files

#### package.json

```json
{
  "name": "chaossettler",
  "version": "0.1.0",
  "private": true,
  "description": "ChaosSettler — Decentralized prediction market resolution using ChaosChain + Chainlink CRE + ERC-8004",
  "workspaces": [
    "cre-workflow",
    "scripts"
  ],
  "scripts": {
    "setup": "yarn workspace scripts run setup-demo",
    "demo": "yarn workspace scripts run demo-run"
  },
  "license": "MIT"
}
```

#### .env.example

```bash
# RPC
RPC_URL=http://localhost:8546

# Deployer / Admin
DEPLOYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

# Contract Addresses (filled after deploy)
STUDIO_PROXY=
REWARDS_DISTRIBUTOR=
IDENTITY_REGISTRY=
REPUTATION_REGISTRY=
CHAOS_CORE=

# Chainlink CRE
KEYSTONE_FORWARDER=0x82300bd7c3958625581cc2f77bc6464dcecdf3e5  # Base Sepolia CRE Simulation
CRE_RECEIVER=                                                    # Filled after deploy

# CRE DON Signer (for local demo without CRE DON — simulates the resolver role)
CRE_DON_ADDRESS=
CRE_DON_PRIVATE_KEY=

# Worker Agent
AGENT_PORT=8000
LLM_API_KEY=
LLM_MODEL=gpt-4o

# Worker Keys (Anvil defaults)
WORKER_A_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
WORKER_B_KEY=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
WORKER_C_KEY=0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6
```

---

### CRE Workflow

#### cre-workflow/package.json

```json
{
  "name": "cre-workflow",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "tsc",
    "start": "ts-node src/index.ts"
  },
  "dependencies": {
    "ethers": "^6.11.0",
    "dotenv": "^16.4.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "ts-node": "^10.9.0",
    "@types/node": "^20.0.0"
  }
}
```

#### cre-workflow/tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

#### cre-workflow/src/types.ts

```typescript
/**
 * Types for the CRE Resolution Workflow
 */

export interface WorkerInfo {
  address: string;
  agentId: bigint;
  stake: bigint;
  a2aEndpoint: string; // parsed from tokenURI JSON
  reputation: number;  // 0-100
}

export interface ResolutionRequest {
  studio: string;
  epoch: number;
  question: string;
  marketId: string;
  deadline: number;
}

export interface WorkerDetermination {
  worker: WorkerInfo;
  determination: boolean;
  confidence: number;
  evidence: string;
  sources: string[];
  respondedAt: number;
}

export interface ChallengeQA {
  worker: WorkerInfo;
  challenges: string[];
  responses: string[];
}

export interface WorkerEvaluation {
  worker: WorkerInfo;
  qualityScore: number;      // 0-100 aggregate quality
  determination: boolean;     // stays off-chain (confidential)
  resolutionQuality?: number; // 0-100 dimension score
  sourceQuality?: number;     // 0-100 dimension score
  analysisDepth?: number;     // 0-100 dimension score
}

export interface ResolutionResult {
  resolution: boolean;
  workers: string[];
  weights: number[];          // blinded: quality × correctnessMult × rep (on-chain)
  dimScores: number[];        // flat: [resQuality, srcQuality, analysis] per worker (on-chain)
  determinations: boolean[];  // off-chain only (for logging/audit)
}
```

#### cre-workflow/src/step1-read.ts

```typescript
/**
 * STEP 1: READ — Read registered workers, endpoints, and reputations from chain
 */
import { ethers } from 'ethers';
import { WorkerInfo } from './types';

const STUDIO_ABI = [
  'event AgentRegistered(uint256 indexed agentId, address indexed agent, uint8 role, uint256 stake)',
  'function getAgentId(address agent) view returns (uint256)',
  'function getAgentStake(uint256 agentId) view returns (uint256)',
  'function getTotalEscrow() view returns (uint256)',
];

const IDENTITY_ABI = [
  'function tokenURI(uint256 tokenId) view returns (string)',
];

const REPUTATION_ABI = [
  'function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)',
];

export async function readRegisteredWorkers(
  provider: ethers.JsonRpcProvider,
  studioAddress: string,
): Promise<{ workers: Array<{ address: string; agentId: bigint; stake: bigint }>, totalEscrow: bigint }> {
  const studio = new ethers.Contract(studioAddress, STUDIO_ABI, provider);
  const totalEscrow: bigint = await studio.getTotalEscrow();

  // Read AgentRegistered events, filter role=1 (WORKER)
  const filter = studio.filters.AgentRegistered();
  const events = await studio.queryFilter(filter, 0, 'latest');

  const workers: Array<{ address: string; agentId: bigint; stake: bigint }> = [];
  for (const event of events) {
    const parsed = studio.interface.parseLog({ topics: event.topics as string[], data: event.data });
    if (!parsed) continue;
    const role = parsed.args[2]; // uint8 role
    if (role !== 1n && role !== 1) continue; // 1 = WORKER

    const agentId = parsed.args[0] as bigint;
    const agentAddr = parsed.args[1] as string;
    const stake: bigint = await studio.getAgentStake(agentId);

    workers.push({ address: agentAddr, agentId, stake });
  }

  return { workers, totalEscrow };
}

export async function readWorkerEndpoints(
  provider: ethers.JsonRpcProvider,
  identityRegistryAddress: string,
  workers: Array<{ agentId: bigint }>,
): Promise<Map<string, string>> {
  const identity = new ethers.Contract(identityRegistryAddress, IDENTITY_ABI, provider);
  const endpointMap = new Map<string, string>();

  for (const worker of workers) {
    try {
      const uri: string = await identity.tokenURI(worker.agentId);
      if (!uri) continue;

      // Fetch metadata JSON
      const response = await fetch(uri);
      const metadata = await response.json();

      // Parse a2a endpoint from metadata
      // Expected format: { "endpoints": [{ "name": "a2a", "endpoint": "https://..." }] }
      const a2aEndpoint = metadata.endpoints?.find(
        (e: { name: string }) => e.name === 'a2a',
      )?.endpoint;

      if (a2aEndpoint) {
        endpointMap.set(worker.agentId.toString(), a2aEndpoint);
      }
    } catch {
      console.warn(`Failed to read endpoint for agent ${worker.agentId}`);
    }
  }

  return endpointMap;
}

export async function readWorkerReputations(
  provider: ethers.JsonRpcProvider,
  reputationRegistryAddress: string,
  rewardsDistributorAddress: string,
  workers: Array<{ agentId: bigint }>,
): Promise<Map<string, number>> {
  const reputation = new ethers.Contract(reputationRegistryAddress, REPUTATION_ABI, provider);
  const repMap = new Map<string, number>();

  for (const worker of workers) {
    try {
      const [count, summaryValue] = await reputation.getSummary(
        worker.agentId,
        [rewardsDistributorAddress], // filter by RewardsDistributor as client
        'RESOLUTION_QUALITY',
        '',
      );

      if (count === 0n) {
        repMap.set(worker.agentId.toString(), 50); // neutral default
      } else {
        const value = Number(summaryValue);
        repMap.set(worker.agentId.toString(), Math.max(10, Math.min(100, value)));
      }
    } catch {
      repMap.set(worker.agentId.toString(), 50);
    }
  }

  return repMap;
}
```

#### cre-workflow/src/step2-ask.ts

```typescript
/**
 * STEP 2: ASK — Send resolution questions to each worker oracle
 */
import { WorkerInfo, WorkerDetermination } from './types';

const TIMEOUT_MS = 30_000;

interface ResolveRequest {
  market_id: string;
  question: string;
  deadline: number;
  context?: string;
}

interface ResolveResponse {
  determination: boolean;
  confidence: number;
  evidence: string;
  sources: string[];
}

export async function askWorkers(
  workers: WorkerInfo[],
  question: string,
  marketId: string,
  deadline: number,
): Promise<WorkerDetermination[]> {
  const results: WorkerDetermination[] = [];

  const promises = workers.map(async (worker) => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const body: ResolveRequest = {
        market_id: marketId,
        question,
        deadline,
      };

      const response = await fetch(`${worker.a2aEndpoint}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data: ResolveResponse = await response.json();

      return {
        worker,
        determination: data.determination,
        confidence: data.confidence,
        evidence: data.evidence,
        sources: data.sources,
        respondedAt: Date.now(),
      } satisfies WorkerDetermination;
    } catch (error) {
      console.warn(`Worker ${worker.address} failed:`, error);
      return null;
    }
  });

  const settled = await Promise.all(promises);

  for (const result of settled) {
    if (result !== null) {
      results.push(result);
    }
  }

  if (results.length === 0) {
    throw new Error('All workers failed to respond');
  }

  return results;
}
```

#### cre-workflow/src/step3-challenge.ts

```typescript
/**
 * STEP 3: CHALLENGE — Generate challenges from contradictions and send to workers
 */
import { WorkerDetermination, ChallengeQA } from './types';

const TIMEOUT_MS = 30_000;

interface ChallengeRequest {
  challenges: string[];
}

interface ChallengeResponse {
  responses: string[];
}

/**
 * Generate challenge questions based on contradictions between worker determinations.
 * In production, this would call an LLM via Confidential HTTP.
 * For demo, we generate based on the evidence.
 */
export function generateChallenges(determinations: WorkerDetermination[]): string[] {
  const challenges: string[] = [];

  // Find contradictions
  const trueGroup = determinations.filter((d) => d.determination === true);
  const falseGroup = determinations.filter((d) => d.determination === false);

  if (trueGroup.length > 0 && falseGroup.length > 0) {
    challenges.push(
      'Other oracles reached the opposite conclusion. What specific evidence supports your position over theirs?',
    );
    challenges.push(
      'What is the strongest counter-argument to your determination, and why is it insufficient?',
    );
  }

  // General quality challenges
  challenges.push('How recent and authoritative are your primary sources?');
  challenges.push('What assumptions does your analysis depend on? Could any be wrong?');

  return challenges;
}

export async function challengeWorkers(
  determinations: WorkerDetermination[],
  challenges: string[],
): Promise<ChallengeQA[]> {
  const results: ChallengeQA[] = [];

  const promises = determinations.map(async (det) => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const body: ChallengeRequest = { challenges };

      const response = await fetch(`${det.worker.a2aEndpoint}/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data: ChallengeResponse = await response.json();

      return {
        worker: det.worker,
        challenges,
        responses: data.responses,
      } satisfies ChallengeQA;
    } catch {
      return {
        worker: det.worker,
        challenges,
        responses: [], // No response = lower quality
      } satisfies ChallengeQA;
    }
  });

  return Promise.all(promises);
}
```

#### cre-workflow/src/step4-evaluate.ts

```typescript
/**
 * STEP 4: EVALUATE — Score each worker's quality 0-100
 *
 * In production, this calls an LLM via Confidential HTTP.
 * For demo, we use a heuristic-based scoring.
 */
import { WorkerDetermination, ChallengeQA, WorkerEvaluation } from './types';

export function evaluateWorkers(
  determinations: WorkerDetermination[],
  challengeQAs: ChallengeQA[],
): WorkerEvaluation[] {
  const evaluations: WorkerEvaluation[] = [];

  for (const det of determinations) {
    let score = 0;

    // 1. Evidence quality (0-30 points)
    if (det.evidence.length > 500) score += 30;
    else if (det.evidence.length > 200) score += 20;
    else if (det.evidence.length > 50) score += 10;

    // 2. Source quality (0-30 points)
    const sourceCount = det.sources.length;
    if (sourceCount >= 3) score += 30;
    else if (sourceCount >= 2) score += 20;
    else if (sourceCount >= 1) score += 10;

    // 3. Confidence calibration (0-20 points)
    // Moderate confidence (0.5-0.8) is better than extreme (>0.95)
    if (det.confidence >= 0.5 && det.confidence <= 0.85) score += 20;
    else if (det.confidence >= 0.3 && det.confidence <= 0.95) score += 10;
    else score += 5;

    // 4. Challenge defense (0-20 points)
    const qa = challengeQAs.find((q) => q.worker.address === det.worker.address);
    if (qa && qa.responses.length > 0) {
      const avgResponseLength =
        qa.responses.reduce((sum, r) => sum + r.length, 0) / qa.responses.length;
      if (avgResponseLength > 200) score += 20;
      else if (avgResponseLength > 100) score += 15;
      else if (avgResponseLength > 30) score += 10;
    }

    evaluations.push({
      worker: det.worker,
      qualityScore: Math.min(100, score),
      determination: det.determination,
    });
  }

  return evaluations;
}
```

#### cre-workflow/src/step5-resolve.ts

```typescript
/**
 * STEP 5: RESOLVE — Weighted majority vote + blinded weights (Option 4)
 *
 * Pure computation, no I/O.
 * Produces weights[] and dimScores[] for on-chain submission.
 * Determinations stay off-chain (confidential in CRE TEE).
 */
import { WorkerEvaluation, ResolutionResult } from './types';

export function resolve(evaluations: WorkerEvaluation[]): ResolutionResult {
  // --- Weighted majority vote ---
  let yesWeight = 0;
  let noWeight = 0;

  for (const ev of evaluations) {
    const weight = ev.qualityScore * ev.worker.reputation;
    if (ev.determination) {
      yesWeight += weight;
    } else {
      noWeight += weight;
    }
  }

  const resolution = yesWeight > noWeight;

  // --- Pre-compute blinded weights (Option 4) ---
  const ACCURATE_MULT = 200;
  const INACCURATE_MULT = 50;

  const workers: string[] = [];
  const weights: number[] = [];        // blinded: quality × correctnessMult × rep
  const dimScores: number[] = [];      // flat: [resQuality, srcQuality, analysis] per worker
  const determinations: boolean[] = []; // stays OFF-CHAIN (not sent to contract)

  for (const ev of evaluations) {
    const correctnessMult =
      ev.determination === resolution ? ACCURATE_MULT : INACCURATE_MULT;

    workers.push(ev.worker.address);
    weights.push(ev.qualityScore * correctnessMult * ev.worker.reputation);
    determinations.push(ev.determination); // off-chain only

    // 3 dimension scores (from Step 4 evaluation)
    dimScores.push(ev.resolutionQuality ?? ev.qualityScore);
    dimScores.push(ev.sourceQuality ?? Math.round(ev.qualityScore * 0.8));
    dimScores.push(ev.analysisDepth ?? Math.round(ev.qualityScore * 0.7));
  }

  return {
    resolution,
    workers,
    weights,       // → on-chain (blinded)
    dimScores,     // → on-chain (3 dims, no accuracy tag)
    determinations, // → OFF-CHAIN only (for logging/audit)
  };
}
```

#### cre-workflow/src/step6-write.ts

> **Two modes**: In production CRE, this step uses `runtime.report()` to produce a DON-signed
> report delivered via KeystoneForwarder → CREReceiver → resolveAndDistribute.
> For local demo/testing, we call `resolveAndDistribute()` directly via an authorized signer.

```typescript
/**
 * STEP 6: WRITE — Submit resolution on-chain
 *
 * Production (CRE DON):
 *   Uses runtime.report() → KeystoneForwarder → CREReceiver.onReport() → resolveAndDistribute()
 *
 * Local demo:
 *   Calls resolveAndDistribute() directly via an authorized signer
 */
import { ethers } from 'ethers';
import { ResolutionResult } from './types';

const REWARDS_DISTRIBUTOR_ABI = [
  'function resolveAndDistribute(address studio, uint64 epoch, address[] workers, uint256[] weights, uint8[] dimScores, bool resolution) external',
];

/**
 * Encode the resolution payload (Option 4: blinded weights).
 * Same format used by CRE runtime.report() and decoded by CREReceiver.onReport().
 * Note: determinations are NOT included (stay off-chain in CRE TEE).
 */
export function encodeResolutionReport(
  studioAddress: string,
  epoch: number,
  result: ResolutionResult,
): string {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  return abiCoder.encode(
    ['address', 'uint64', 'address[]', 'uint256[]', 'uint8[]', 'bool'],
    [
      studioAddress,
      epoch,
      result.workers,
      result.weights,
      result.dimScores,
      result.resolution,
    ],
  );
}

/**
 * Write resolution directly (local demo mode).
 * In production, this is replaced by runtime.report() in the CRE workflow.
 */
export async function writeResolution(
  signer: ethers.Signer,
  rewardsDistributorAddress: string,
  studioAddress: string,
  epoch: number,
  result: ResolutionResult,
): Promise<ethers.TransactionReceipt> {
  const contract = new ethers.Contract(
    rewardsDistributorAddress,
    REWARDS_DISTRIBUTOR_ABI,
    signer,
  );

  console.log('Submitting resolution on-chain (direct mode)...');
  console.log(`  Studio: ${studioAddress}`);
  console.log(`  Epoch: ${epoch}`);
  console.log(`  Resolution: ${result.resolution}`);
  console.log(`  Workers: ${result.workers.length}`);
  console.log(`  Weights: ${result.weights}`);

  const tx = await contract.resolveAndDistribute(
    studioAddress,
    epoch,
    result.workers,
    result.weights,
    result.dimScores,
    result.resolution,
  );

  const receipt = await tx.wait();
  console.log(`  Tx hash: ${receipt.hash}`);
  console.log(`  Gas used: ${receipt.gasUsed}`);

  return receipt;
}

/*
 * ═══════════════════════════════════════════════════════════
 * CRE PRODUCTION MODE (reference — used inside CRE workflow)
 * ═══════════════════════════════════════════════════════════
 *
 * In the actual CRE workflow WASM/capability, Step 6 looks like:
 *
 *   import { runtime } from '@chainlink/cre-sdk';
 *
 *   // Encode the resolution as the report payload
 *   const payload = encodeResolutionReport(studio, epoch, result);
 *
 *   // runtime.report() produces a DON-signed report
 *   // The CRE runtime delivers it to KeystoneForwarder.report()
 *   // which calls CREReceiver.onReport(metadata, payload)
 *   runtime.report(payload);
 *
 * The CREReceiver contract decodes the payload and calls
 * rewardsDistributor.resolveAndDistribute() with the decoded args.
 */
```

#### cre-workflow/src/index.ts

```typescript
/**
 * ChaosSettler CRE Resolution Workflow — Entry Point
 *
 * Orchestrates the 6-step resolution:
 * 1. READ: workers, endpoints, reputations from chain
 * 2. ASK: POST /a2a/resolve to each worker
 * 3. CHALLENGE: Generate + send challenges
 * 4. EVALUATE: Score quality 0-100
 * 5. RESOLVE: Weighted majority vote
 * 6. WRITE: resolveAndDistribute on-chain
 */
import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import { WorkerInfo, ResolutionRequest } from './types';
import { readRegisteredWorkers, readWorkerEndpoints, readWorkerReputations } from './step1-read';
import { askWorkers } from './step2-ask';
import { generateChallenges, challengeWorkers } from './step3-challenge';
import { evaluateWorkers } from './step4-evaluate';
import { resolve } from './step5-resolve';
import { writeResolution } from './step6-write';

dotenv.config({ path: '../.env' });

async function runWorkflow(request: ResolutionRequest) {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const creSigner = new ethers.Wallet(process.env.CRE_DON_PRIVATE_KEY!, provider);

  console.log('=== ChaosSettler Resolution Workflow ===');
  console.log(`Question: ${request.question}`);
  console.log(`Studio: ${request.studio}`);

  // STEP 1: READ
  console.log('\n--- Step 1: READ ---');
  const { workers: rawWorkers, totalEscrow } = await readRegisteredWorkers(provider, request.studio);
  console.log(`Found ${rawWorkers.length} workers, total escrow: ${ethers.formatEther(totalEscrow)} ETH`);

  if (rawWorkers.length === 0) throw new Error('No workers registered');

  const endpoints = await readWorkerEndpoints(
    provider,
    process.env.IDENTITY_REGISTRY!,
    rawWorkers,
  );

  const reputations = await readWorkerReputations(
    provider,
    process.env.REPUTATION_REGISTRY!,
    process.env.REWARDS_DISTRIBUTOR!,
    rawWorkers,
  );

  const workerInfos: WorkerInfo[] = rawWorkers
    .filter((w) => endpoints.has(w.agentId.toString()))
    .map((w) => ({
      address: w.address,
      agentId: w.agentId,
      stake: w.stake,
      a2aEndpoint: endpoints.get(w.agentId.toString())!,
      reputation: reputations.get(w.agentId.toString()) ?? 50,
    }));

  console.log(`Workers with endpoints: ${workerInfos.length}`);

  // STEP 2: ASK
  console.log('\n--- Step 2: ASK ---');
  const determinations = await askWorkers(
    workerInfos,
    request.question,
    request.marketId,
    request.deadline,
  );
  console.log(`Received ${determinations.length} determinations`);
  for (const d of determinations) {
    console.log(`  ${d.worker.address}: ${d.determination} (confidence: ${d.confidence})`);
  }

  // STEP 3: CHALLENGE
  console.log('\n--- Step 3: CHALLENGE ---');
  const challenges = generateChallenges(determinations);
  console.log(`Generated ${challenges.length} challenges`);
  const challengeQAs = await challengeWorkers(determinations, challenges);

  // STEP 4: EVALUATE
  console.log('\n--- Step 4: EVALUATE ---');
  const evaluations = evaluateWorkers(determinations, challengeQAs);
  for (const ev of evaluations) {
    console.log(`  ${ev.worker.address}: quality=${ev.qualityScore}`);
  }

  // STEP 5: RESOLVE
  console.log('\n--- Step 5: RESOLVE ---');
  const result = resolve(evaluations);
  console.log(`Resolution: ${result.resolution}`);

  // STEP 6: WRITE
  console.log('\n--- Step 6: WRITE ---');
  const receipt = await writeResolution(
    creSigner,
    process.env.REWARDS_DISTRIBUTOR!,
    request.studio,
    request.epoch,
    result,
  );

  console.log('\n=== Resolution Complete ===');
  console.log(`Block: ${receipt.blockNumber}`);

  return result;
}

// Run if called directly
const args = process.argv.slice(2);
if (args.length > 0) {
  runWorkflow({
    studio: process.env.STUDIO_PROXY!,
    epoch: parseInt(args[0] || '1'),
    question: args[1] || 'Will SEC approve Solana ETF by end of 2026?',
    marketId: args[2] || 'market-001',
    deadline: Math.floor(Date.now() / 1000) + 3600,
  }).catch(console.error);
}

export { runWorkflow };
```

---

### Agent (Python — AI Oracle Worker)

#### agent/requirements.txt

```
fastapi==0.109.0
uvicorn==0.27.0
httpx==0.26.0
openai==1.12.0
pydantic==2.6.0
python-dotenv==1.0.0
```

#### agent/Dockerfile

```dockerfile
FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/

EXPOSE 8000
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

#### agent/src/config.py

```python
"""Agent configuration."""
import os
from dotenv import load_dotenv

load_dotenv()

LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o")
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1")
AGENT_PORT = int(os.getenv("AGENT_PORT", "8000"))
AGENT_NAME = os.getenv("AGENT_NAME", "ChaosSettler Oracle")
```

#### agent/src/main.py

```python
"""ChaosSettler Worker Agent — AI Oracle for prediction market resolution."""
from fastapi import FastAPI
from src.routes.a2a import router as a2a_router
from src.config import AGENT_NAME

app = FastAPI(title=AGENT_NAME, version="0.1.0")
app.include_router(a2a_router)


@app.get("/health")
async def health():
    return {"status": "ok", "agent": AGENT_NAME}
```

#### agent/src/routes/a2a.py

```python
"""A2A endpoints for the oracle worker agent."""
from fastapi import APIRouter
from pydantic import BaseModel
from src.services.investigator import investigate
from src.services.defender import defend

router = APIRouter(prefix="/a2a")


# ─── Resolve ─────────────────────────────────────────

class ResolveRequest(BaseModel):
    market_id: str
    question: str
    deadline: int | None = None
    context: str | None = None


class ResolveResponse(BaseModel):
    determination: bool
    confidence: float
    evidence: str
    sources: list[str]


@router.post("/resolve", response_model=ResolveResponse)
async def resolve(req: ResolveRequest) -> ResolveResponse:
    """
    Investigate a question and determine the outcome.
    The worker acts as an oracle: researches the topic, evaluates evidence,
    and returns a determination (true/false) with supporting evidence.
    """
    result = await investigate(req.question, req.context)
    return ResolveResponse(
        determination=result["determination"],
        confidence=result["confidence"],
        evidence=result["evidence"],
        sources=result["sources"],
    )


# ─── Challenge ────────────────────────────────────────

class ChallengeRequest(BaseModel):
    challenges: list[str]


class ChallengeResponse(BaseModel):
    responses: list[str]


@router.post("/challenge", response_model=ChallengeResponse)
async def challenge(req: ChallengeRequest) -> ChallengeResponse:
    """
    Defend previous determination against challenge questions.
    The worker must justify its reasoning when challenged by the CRE DON.
    """
    responses = await defend(req.challenges)
    return ChallengeResponse(responses=responses)
```

#### agent/src/services/investigator.py

```python
"""
Investigation service — the core of the oracle worker.

Flow:
1. Receive question
2. Generate search queries
3. Fetch and parse sources (simulated for demo)
4. LLM analyzes evidence and determines outcome
5. Return determination + evidence + sources
"""
from openai import AsyncOpenAI
from src.config import LLM_API_KEY, LLM_MODEL, LLM_BASE_URL

client = AsyncOpenAI(api_key=LLM_API_KEY, base_url=LLM_BASE_URL) if LLM_API_KEY else None


async def investigate(question: str, context: str | None = None) -> dict:
    """
    Investigate a question and return a determination.

    Returns:
        dict with keys: determination (bool), confidence (float),
                        evidence (str), sources (list[str])
    """
    if not client:
        # Fallback: deterministic response for demo/testing without API key
        return _mock_investigation(question)

    system_prompt = """You are a decentralized oracle agent investigating a prediction market question.
Your job is to research the question thoroughly and determine the most likely outcome.

You MUST respond in valid JSON with exactly these fields:
{
  "determination": true or false,
  "confidence": 0.0 to 1.0,
  "evidence": "detailed analysis (2-3 paragraphs)",
  "sources": ["source1 description", "source2 description", "source3 description"]
}

Be thorough but honest about uncertainty. Cite specific facts."""

    user_prompt = f"Question: {question}"
    if context:
        user_prompt += f"\n\nAdditional context: {context}"

    response = await client.chat.completions.create(
        model=LLM_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0,
        response_format={"type": "json_object"},
    )

    import json
    result = json.loads(response.choices[0].message.content or "{}")

    return {
        "determination": bool(result.get("determination", False)),
        "confidence": float(result.get("confidence", 0.5)),
        "evidence": str(result.get("evidence", "")),
        "sources": list(result.get("sources", [])),
    }


def _mock_investigation(question: str) -> dict:
    """Deterministic mock for testing without LLM API."""
    q = question.lower()

    # Simple keyword-based determination for demo
    if "bitcoin" in q and ("200k" in q or "200,000" in q):
        return {
            "determination": False,
            "confidence": 0.65,
            "evidence": "Based on historical price analysis and current market conditions, "
                        "Bitcoin reaching $200k in the near term is unlikely but not impossible. "
                        "Current market cap would need to more than double from current levels.",
            "sources": ["CoinGecko price history", "Bloomberg crypto analysis", "Federal Reserve monetary policy statements"],
        }
    elif "ethereum" in q and "pos" in q:
        return {
            "determination": True,
            "confidence": 0.99,
            "evidence": "Ethereum successfully transitioned to Proof of Stake via The Merge on September 15, 2022. "
                        "This is a historical fact confirmed by the Ethereum Foundation and blockchain records.",
            "sources": ["Ethereum Foundation blog", "Etherscan block records", "CoinDesk reporting on The Merge"],
        }
    else:
        # Default: hash-based deterministic response
        import hashlib
        h = int(hashlib.sha256(question.encode()).hexdigest(), 16)
        return {
            "determination": h % 2 == 0,
            "confidence": 0.55 + (h % 30) / 100,
            "evidence": f"Analysis of the question '{question}' based on available evidence suggests "
                        f"{'a positive' if h % 2 == 0 else 'a negative'} outcome. "
                        "This determination is based on general knowledge and publicly available information.",
            "sources": ["General knowledge base", "Public records", "News analysis"],
        }
```

#### agent/src/services/defender.py

```python
"""
Defense service — respond to challenge questions about previous determination.
"""
from openai import AsyncOpenAI
from src.config import LLM_API_KEY, LLM_MODEL, LLM_BASE_URL

client = AsyncOpenAI(api_key=LLM_API_KEY, base_url=LLM_BASE_URL) if LLM_API_KEY else None


async def defend(challenges: list[str]) -> list[str]:
    """
    Respond to challenge questions defending the previous determination.

    Args:
        challenges: List of challenge questions from CRE DON

    Returns:
        List of responses, one per challenge
    """
    if not client:
        return _mock_defense(challenges)

    responses = []
    for challenge in challenges:
        response = await client.chat.completions.create(
            model=LLM_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "You are an oracle agent defending your previous determination. "
                               "Answer the challenge question directly and concisely. "
                               "Cite specific evidence. Be honest about limitations.",
                },
                {"role": "user", "content": challenge},
            ],
            temperature=0,
            max_tokens=300,
        )
        responses.append(response.choices[0].message.content or "No response.")

    return responses


def _mock_defense(challenges: list[str]) -> list[str]:
    """Mock defense for testing without LLM API."""
    return [
        f"Regarding '{c[:50]}...': My determination is based on multiple corroborating sources "
        "and established facts. The evidence strongly supports this conclusion, and I maintain "
        "my position with confidence."
        for c in challenges
    ]
```

#### agent/tests/test_resolve.py

```python
"""Tests for /a2a/resolve endpoint."""
import pytest
from fastapi.testclient import TestClient
from src.main import app

client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_resolve_returns_determination():
    response = client.post(
        "/a2a/resolve",
        json={
            "market_id": "test-001",
            "question": "Did Ethereum transition to Proof of Stake in September 2022?",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert "determination" in data
    assert isinstance(data["determination"], bool)
    assert "confidence" in data
    assert 0.0 <= data["confidence"] <= 1.0
    assert "evidence" in data
    assert len(data["evidence"]) > 0
    assert "sources" in data
    assert isinstance(data["sources"], list)


def test_resolve_with_context():
    response = client.post(
        "/a2a/resolve",
        json={
            "market_id": "test-002",
            "question": "Will Bitcoin reach $200,000?",
            "context": "Consider current macroeconomic conditions",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data["determination"], bool)
```

#### agent/tests/test_challenge.py

```python
"""Tests for /a2a/challenge endpoint."""
from fastapi.testclient import TestClient
from src.main import app

client = TestClient(app)


def test_challenge_returns_responses():
    response = client.post(
        "/a2a/challenge",
        json={
            "challenges": [
                "Why do you believe this outcome is more likely?",
                "What counter-evidence have you considered?",
            ],
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert "responses" in data
    assert len(data["responses"]) == 2
    for r in data["responses"]:
        assert len(r) > 0


def test_challenge_empty_list():
    response = client.post(
        "/a2a/challenge",
        json={"challenges": []},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["responses"] == []
```

---

### Scripts (TypeScript — Setup and Demo)

#### scripts/package.json

```json
{
  "name": "scripts",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "register-worker": "ts-node register-worker.ts",
    "create-market": "ts-node create-market.ts",
    "setup-demo": "ts-node setup-demo.ts",
    "demo-run": "ts-node demo-run.ts"
  },
  "dependencies": {
    "ethers": "^6.11.0",
    "dotenv": "^16.4.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "ts-node": "^10.9.0",
    "@types/node": "^20.0.0"
  }
}
```

#### scripts/register-worker.ts

```typescript
/**
 * Register a worker oracle in the ChaosSettler Studio.
 *
 * Usage: ts-node register-worker.ts <WORKER_PRIVATE_KEY> <STUDIO_PROXY> <STAKE_ETH>
 *
 * Steps:
 * 1. Mint ERC-8004 identity NFT
 * 2. Register in StudioProxy with stake
 */
import { ethers } from 'ethers';
import * as dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

const IDENTITY_ABI = ['function register() external returns (uint256 agentId)'];
const STUDIO_ABI = ['function registerAgent(uint256 agentId, uint8 role) external payable'];

async function registerWorker(
  privateKey: string,
  studioProxy: string,
  stakeEth: string,
) {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log(`Registering worker: ${wallet.address}`);

  // 1. Mint identity
  const identity = new ethers.Contract(
    process.env.IDENTITY_REGISTRY!,
    IDENTITY_ABI,
    wallet,
  );
  const regTx = await identity.register();
  const regReceipt = await regTx.wait();

  const transferTopic = ethers.id('Transfer(address,address,uint256)');
  const transferEvent = regReceipt.logs.find(
    (log: ethers.Log) => log.topics[0] === transferTopic,
  );
  const agentId = transferEvent ? BigInt(transferEvent.topics[3]) : 0n;
  console.log(`  Agent ID: ${agentId}`);

  // 2. Register in studio
  const studio = new ethers.Contract(studioProxy, STUDIO_ABI, wallet);
  const stakeTx = await studio.registerAgent(agentId, 1, {
    value: ethers.parseEther(stakeEth),
  });
  await stakeTx.wait();

  console.log(`  Staked: ${stakeEth} ETH`);
  console.log(`  Registered as WORKER`);

  return agentId;
}

// CLI
const [key, proxy, stake] = process.argv.slice(2);
if (key && proxy) {
  registerWorker(key, proxy, stake || '0.01').catch(console.error);
} else {
  console.log('Usage: ts-node register-worker.ts <PRIVATE_KEY> <STUDIO_PROXY> [STAKE_ETH]');
}

export { registerWorker };
```

#### scripts/create-market.ts

```typescript
/**
 * Create a resolution market in the ChaosSettler Studio.
 *
 * Usage: ts-node create-market.ts <QUESTION> [REWARD_ETH] [DURATION_DAYS]
 */
import { ethers } from 'ethers';
import * as dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

const RESOLUTION_LOGIC_ABI = [
  'function createMarket(string question, uint256 rewardPool, uint256 duration) returns (bytes32)',
];

async function createMarket(question: string, rewardEth: string, durationDays: number) {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY!, provider);

  const studio = new ethers.Contract(
    process.env.STUDIO_PROXY!,
    RESOLUTION_LOGIC_ABI,
    wallet,
  );

  const rewardPool = ethers.parseEther(rewardEth);
  const duration = durationDays * 24 * 60 * 60;

  console.log(`Creating market: "${question}"`);
  console.log(`  Reward: ${rewardEth} ETH`);
  console.log(`  Duration: ${durationDays} days`);

  const tx = await studio.createMarket(question, rewardPool, duration);
  const receipt = await tx.wait();

  // Parse MarketCreated event
  const marketCreatedTopic = ethers.id(
    'MarketCreated(bytes32,string,uint256,uint256,address)',
  );
  const event = receipt.logs.find(
    (log: ethers.Log) => log.topics[0] === marketCreatedTopic,
  );
  const marketId = event?.topics[1] || 'unknown';

  console.log(`  Market ID: ${marketId}`);
  return marketId;
}

// CLI
const [question, reward, days] = process.argv.slice(2);
if (question) {
  createMarket(question, reward || '1', parseInt(days || '7')).catch(console.error);
} else {
  console.log('Usage: ts-node create-market.ts <QUESTION> [REWARD_ETH] [DURATION_DAYS]');
}

export { createMarket };
```

#### scripts/setup-demo.ts

```typescript
/**
 * Full demo setup: deploy, create markets, register workers.
 * Assumes contracts are already deployed (run DeployChaosSettler.s.sol first).
 */
import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import { registerWorker } from './register-worker';
import { createMarket } from './create-market';

dotenv.config({ path: '../.env' });

async function setupDemo() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║     ChaosSettler Demo Setup           ║');
  console.log('╚══════════════════════════════════════╝\n');

  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

  // Register 3 workers
  console.log('==> Registering workers...\n');
  const workerKeys = [
    process.env.WORKER_A_KEY!,
    process.env.WORKER_B_KEY!,
    process.env.WORKER_C_KEY!,
  ];

  for (let i = 0; i < workerKeys.length; i++) {
    if (!workerKeys[i]) {
      console.log(`  Skipping worker ${i + 1} (no key)`);
      continue;
    }
    await registerWorker(workerKeys[i], process.env.STUDIO_PROXY!, '0.01');
    console.log('');
  }

  // Create 3 demo markets
  console.log('==> Creating demo markets...\n');
  const markets = [
    { question: 'Will SEC approve a Solana ETF by end of 2026?', reward: '0.3', days: 30 },
    { question: 'Did Ethereum transition to Proof of Stake in September 2022?', reward: '0.3', days: 7 },
    { question: 'Will Bitcoin reach $200,000 by end of 2026?', reward: '0.3', days: 60 },
  ];

  for (const m of markets) {
    await createMarket(m.question, m.reward, m.days);
    console.log('');
  }

  console.log('=== Setup Complete ===');
  console.log('Next: start worker agents, then run demo-run.ts');
}

setupDemo().catch(console.error);
```

#### scripts/demo-run.ts

```typescript
/**
 * Run the complete ChaosSettler resolution flow.
 *
 * Prerequisites:
 * - Contracts deployed (DeployChaosSettler.s.sol)
 * - Workers registered (setup-demo.ts)
 * - Agent servers running (uvicorn on ports 8000, 8001, 8002)
 */
import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import { runWorkflow } from '../cre-workflow/src/index';

dotenv.config({ path: '../.env' });

const STUDIO_ABI = [
  'function getWithdrawableBalance(address) view returns (uint256)',
  'function getTotalEscrow() view returns (uint256)',
];

async function runDemo() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║     ChaosSettler Demo Run             ║');
  console.log('╚══════════════════════════════════════╝\n');

  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const studioProxy = process.env.STUDIO_PROXY!;
  const studio = new ethers.Contract(studioProxy, STUDIO_ABI, provider);

  // Show initial state
  const escrowBefore = await studio.getTotalEscrow();
  console.log(`Studio escrow before: ${ethers.formatEther(escrowBefore)} ETH\n`);

  // Run resolution for Market 1
  console.log('=== Market 1: SEC Solana ETF? ===\n');
  const result1 = await runWorkflow({
    studio: studioProxy,
    epoch: 1,
    question: 'Will SEC approve a Solana ETF by end of 2026?',
    marketId: 'market-001',
    deadline: Math.floor(Date.now() / 1000) + 3600,
  });

  // Show results
  console.log(`\nResolution: ${result1.resolution ? 'YES' : 'NO'}`);

  // Show withdrawable balances
  const workerKeys = [
    process.env.WORKER_A_KEY!,
    process.env.WORKER_B_KEY!,
    process.env.WORKER_C_KEY!,
  ];

  console.log('\n=== Worker Balances ===');
  for (let i = 0; i < workerKeys.length; i++) {
    if (!workerKeys[i]) continue;
    const wallet = new ethers.Wallet(workerKeys[i]);
    const balance = await studio.getWithdrawableBalance(wallet.address);
    console.log(`  Worker ${i + 1} (${wallet.address}): ${ethers.formatEther(balance)} ETH`);
  }

  const escrowAfter = await studio.getTotalEscrow();
  console.log(`\nStudio escrow after: ${ethers.formatEther(escrowAfter)} ETH`);
  console.log(`Distributed: ${ethers.formatEther(escrowBefore - escrowAfter)} ETH`);
}

runDemo().catch(console.error);
```

---

## VALIDATION CHECKLIST

### Phase 1: Contracts

```bash
# From packages/contracts/
forge build                                            # Compiles all
forge test                                             # All existing tests pass
forge test --match-contract ResolveAndDistribute -vvv  # New tests pass
forge test --match-contract ResolutionMarketLogic -vvv # Logic module tests pass
forge test --match-contract CREReceiver -vvv           # CRE bridge tests pass
```

### Phase 2: Agent

```bash
# From chaossettler/agent/
pip install -r requirements.txt
uvicorn src.main:app --port 8000 &
curl http://localhost:8000/health
curl -X POST http://localhost:8000/a2a/resolve \
  -H 'Content-Type: application/json' \
  -d '{"market_id":"test","question":"Did Ethereum move to PoS?"}'
pytest tests/ -v
```

### Phase 3: Integration

```bash
# Terminal 1: Anvil
anvil --port 8546

# Terminal 2: Deploy
cd packages/contracts
forge script script/DeployChaosSettler.s.sol --rpc-url http://localhost:8546 --broadcast

# Terminal 3: Agents (run 2-3 instances)
cd chaossettler/agent
uvicorn src.main:app --port 8000 &
uvicorn src.main:app --port 8001 &

# Terminal 4: Setup + Run
cd chaossettler
yarn setup
yarn demo
```
