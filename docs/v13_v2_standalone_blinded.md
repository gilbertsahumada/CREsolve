# v13_v2 — ChaosSettler Standalone con Option 4 Blinded

> **Estado**: Blueprint activo para el hackathon. Combina la arquitectura standalone
> de v13 con el scoring Option 4 Blinded de SCORING_CONFIDENTIALITY_ANALYSIS.md.
>
> **Decisiones incorporadas**:
> - Option 4: Multi-dimensional Blinded (`weights[]` + `dimScores[]`, sin `determinations[]` on-chain)
> - 3 dimensiones on-chain: Resolution Quality, Source Quality, Analysis Depth
> - 5 dimensiones PoA off-chain (evaluadas en CRE TEE, no publicadas)
> - Workers son oráculos descentralizados de IA (no predicen, investigan)
> - CRE DON es el evaluador imparcial (no hay verifiers separados)
> - Challenge Q&A no se persiste (CRE stateless = privacidad)
>
> **Usa ChaosChain**: Sí — StudioProxy para escrow/staking, RewardsDistributor para resolución,
> ERC-8004 para identidad/reputación. No es standalone de verdad — usa la infraestructura existente.
>
> **Todo el código a escribir está en este documento + IMPLEMENTATION_GUIDE.md**

---

## 1. Arquitectura

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  COMPONENTES                                                               │
│                                                                             │
│  A. Contratos Solidity (branch hackathon/chaos-settler en chaoschain)      │
│     ├── RewardsDistributor.sol    — MODIFICADO (+resolveAndDistribute)      │
│     ├── ResolutionMarketLogic.sol — NUEVO (LogicModule para markets)       │
│     ├── CREReceiver.sol           — NUEVO (puente KeystoneForwarder)       │
│     └── Tests + Deploy script     — PENDIENTE                              │
│                                                                             │
│  B. CRE Resolution Workflow (TypeScript, ~585 líneas)                      │
│     ├── 6 steps: READ → ASK → CHALLENGE → EVALUATE → RESOLVE → WRITE     │
│     ├── Compila a WASM para ejecutar en DON                                │
│     └── Local demo mode: llama resolveAndDistribute directamente           │
│                                                                             │
│  C. Worker Agent (Python/FastAPI, ~250 líneas)                             │
│     ├── POST /a2a/resolve  — investiga y determina outcome                 │
│     ├── POST /a2a/challenge — defiende su determinación                    │
│     └── Mock + LLM modes                                                   │
│                                                                             │
│  D. Scripts (TypeScript, ~340 líneas)                                      │
│     ├── register-worker.ts — Minta identity + registra en Studio           │
│     ├── create-market.ts   — Crea mercado con pregunta + reward            │
│     ├── setup-demo.ts      — Deploy + setup + register workers             │
│     └── demo-run.ts        — Full loop con 3 mercados                      │
│                                                                             │
│  INFRAESTRUCTURA EXISTENTE (ChaosChain, sin cambios)                       │
│     ├── ChaosChainRegistry — Registro central                              │
│     ├── ChaosCore — Factory de Studios                                     │
│     ├── StudioProxy — Escrow, staking, registro de agentes                 │
│     ├── StudioProxyFactory — Crea proxies                                  │
│     ├── ERC-8004 — Identity NFT + Reputation Registry                      │
│     └── Scoring.sol — Librería de consenso MAD (no usada por ChaosSettler) │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Diagrama de Secuencia Completo

```
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ Creador  │ │ Worker A │ │ Worker B │ │ CRE DON  │ │CREReceiver│ │ Rewards  │
│          │ │          │ │          │ │  (TEE)   │ │          │ │Distributor│
└────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘
     │              │              │              │              │              │
     │ ══════════ FASE 1: SETUP ════════════     │              │              │
     │              │              │              │              │              │
     │  deposit{value: 1 ETH}     │              │              │              │
     │──────────────────────────────────────────────────────────────────────────>
     │              │              │              │              │              │
     │  createMarket("¿SEC ETF?", 1 ETH, 7 days)│              │              │
     │──────────────────────────────────────────────────────────────────────────>
     │  → marketId  │              │              │              │              │
     │              │              │              │              │              │
     │              │  registerAgent{0.01 ETH}    │              │              │
     │              │──────────────────────────────────────────────────────────>
     │              │              │              │              │              │
     │              │              │  registerAgent{0.01 ETH}    │              │
     │              │              │──────────────────────────────────────────>│
     │              │              │              │              │              │
     │ ══════════ FASE 2: CRE RESOLUTION ═══════ │              │              │
     │              │              │              │              │              │
     │              │              │              │  Step 1: READ│              │
     │              │              │              │─────────────────────────────>
     │              │              │              │  workers,    │              │
     │              │              │              │  stakes,     │              │
     │              │              │              │  reputations │              │
     │              │              │              │              │              │
     │              │              │              │  Step 2: ASK │              │
     │              │  POST /a2a/resolve          │              │              │
     │              │<────────────────────────────│              │              │
     │              │  {determination, evidence}  │              │              │
     │              │              │              │              │              │
     │              │              │  POST /resolve│             │              │
     │              │              │<─────────────│              │              │
     │              │              │              │              │              │
     │              │              │              │  Step 3: CHALLENGE          │
     │              │  POST /a2a/challenge         │              │              │
     │              │<────────────────────────────│              │              │
     │              │  {responses} │              │              │              │
     │              │              │  POST /challenge             │              │
     │              │              │<─────────────│              │              │
     │              │              │              │              │              │
     │              │              │              │  Step 4: EVALUATE           │
     │              │              │              │  (LLM in TEE)│              │
     │              │              │              │  A: quality=90              │
     │              │              │              │  B: quality=40              │
     │              │              │              │              │              │
     │              │              │              │  Step 5: RESOLVE            │
     │              │              │              │  vote: YES>NO│              │
     │              │              │              │  weights[]=  │              │
     │              │              │              │  [900000,    │              │
     │              │              │              │   100000]    │              │
     │              │              │              │              │              │
     │              │              │              │  Step 6: WRITE              │
     │              │              │              │──runtime.report()──>        │
     │              │              │              │              │  onReport()  │
     │              │              │              │              │──────────────>
     │              │              │              │              │ resolveAnd   │
     │              │              │              │              │ Distribute() │
     │              │              │              │              │              │
     │ ══════════ FASE 3: WITHDRAW ═════════════ │              │              │
     │              │              │              │              │              │
     │              │  withdraw()  │              │              │              │
     │              │──────────────────────────────────────────────────────────>
     │              │  0.88 ETH + 0.01 ETH stake │              │              │
     │              │              │              │              │              │
     │              │              │  withdraw()  │              │              │
     │              │              │──────────────────────────────────────────>│
     │              │              │  0.10 ETH + 0.01 ETH stake │              │
     │              │              │              │              │              │
```

---

## 3. Contratos Solidity

### 3.1 Estado Actual (committed)

| Archivo | Estado | Descripción |
|---------|--------|-------------|
| `RewardsDistributor.sol` | **Modificado** | +`resolveAndDistribute()` Option 4 + `_publishResolutionReputation()` + `_getReputation()` + `setAuthorizedResolver()` |
| `ResolutionMarketLogic.sol` | **Nuevo** | LogicModule: `createMarket()`, `getMarket()`, `isMarketActive()`, `getScoringCriteria()` (8 dims) |
| `CREReceiver.sol` | **Staging** | Existe pero vacío — código completo abajo |

### 3.2 Pendiente (código completo en §3.4-3.8)

| Archivo | Líneas est. | Descripción |
|---------|-------------|-------------|
| `CREReceiver.sol` | ~65 | Puente KeystoneForwarder → resolveAndDistribute |
| `ResolveAndDistribute.t.sol` | ~200 | Tests de resolveAndDistribute |
| `CREReceiver.t.sol` | ~120 | Tests del bridge |
| `ResolutionMarketLogic.t.sol` | ~100 | Tests del LogicModule |
| `DeployChaosSettler.s.sol` | ~100 | Deploy script (Anvil + Base Sepolia) |

### 3.3 Firma de resolveAndDistribute (ya implementada)

```solidity
function resolveAndDistribute(
    address studio,              // StudioProxy address
    uint64 epoch,                // Epoch number for tracking
    address[] calldata workers,  // Worker addresses (max 10)
    uint256[] calldata weights,  // Pre-computed: quality × correctnessMult × rep
    uint8[] calldata dimScores,  // Flat: [w0_resQ, w0_srcQ, w0_analysis, w1_resQ, ...]
    bool resolution              // Final weighted answer (true/false)
) external onlyOwnerResolver
```

**Qué hace**:
1. Valida inputs (studio != 0, workers.length <= 10, arrays match)
2. Calcula reward pool = totalEscrow - sum(stakes)
3. Por cada worker: `reward = rewardPool × weight[i] / totalWeight`
4. Libera reward + devuelve stake via `studioProxy.releaseFunds()`
5. Publica 3 dimensiones de reputación (sin tag ACCURATE/INACCURATE)
6. Registra epoch work

**Qué NO hace**:
- NO recibe `determinations[]` (votos se quedan en CRE TEE)
- NO calcula consenso MAD (CRE lo reemplaza)
- NO distribuye a validadores (CRE es el evaluador)
- NO publica las 5 dimensiones PoA (no aplican a oráculos independientes)

### 3.4 Bug Fix Pendiente: Double-call Guard

> **Encontrado en análisis del 14 Feb**: `resolveAndDistribute()` no tiene guard contra double-call.
> Si se llama dos veces para el mismo studio + epoch, workers podrían cobrar doble.

**Agregar a RewardsDistributor.sol**:

```solidity
// Nuevo estado (después de _workValidators, ~línea 75)
mapping(address => mapping(uint64 => bool)) private _epochResolved;

// Al inicio de resolveAndDistribute() (después de validaciones):
require(!_epochResolved[studio][epoch], "Already resolved");

// Al final de resolveAndDistribute() (antes del emit):
_epochResolved[studio][epoch] = true;
```

### 3.5 CREReceiver.sol — Código Completo

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IReceiver {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

interface IRewardsDistributorCRE {
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
 */
contract CREReceiver is IReceiver, Ownable {
    IRewardsDistributorCRE public immutable rewardsDistributor;
    address public keystoneForwarder;

    event ReportReceived(bytes32 indexed workflowId, address indexed studio, uint64 epoch);
    event ForwarderUpdated(address indexed oldForwarder, address indexed newForwarder);

    error UnauthorizedForwarder(address caller);

    constructor(
        address _rewardsDistributor,
        address _keystoneForwarder
    ) Ownable(msg.sender) {
        rewardsDistributor = IRewardsDistributorCRE(_rewardsDistributor);
        keystoneForwarder = _keystoneForwarder;
    }

    function setKeystoneForwarder(address _newForwarder) external onlyOwner {
        address old = keystoneForwarder;
        keystoneForwarder = _newForwarder;
        emit ForwarderUpdated(old, _newForwarder);
    }

    function onReport(bytes calldata metadata, bytes calldata report) external override {
        if (msg.sender != keystoneForwarder) {
            revert UnauthorizedForwarder(msg.sender);
        }

        // Decode Option 4: blinded weights (no determinations)
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
            studio, epoch, workers, weights, dimScores, resolution
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

### 3.6 KeystoneForwarder Pattern

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

**KeystoneForwarder address**: `0x82300bd7c3958625581cc2f77bc6464dcecdf3e5` (Base Sepolia CRE Simulation)

**Authorization chain**:
1. KeystoneForwarder calls `CREReceiver.onReport()` → msg.sender = KeystoneForwarder
2. CREReceiver calls `RewardsDistributor.resolveAndDistribute()` → msg.sender = CREReceiver
3. `setAuthorizedResolver(address(creReceiver), true)` authorizes the CREReceiver

### 3.7 Report Encoding (CRE → CREReceiver)

```solidity
// What CRE workflow encodes in step6-write.ts:
bytes memory report = abi.encode(
    studio,      // address
    epoch,       // uint64
    workers,     // address[]
    weights,     // uint256[]  ← blinded: quality × correctnessMult × rep
    dimScores,   // uint8[]    ← flat: [resQ, srcQ, analysis] per worker
    resolution   // bool
);

// What CREReceiver.onReport() decodes:
(address studio, uint64 epoch, address[] memory workers,
 uint256[] memory weights, uint8[] memory dimScores, bool resolution)
    = abi.decode(report, (address, uint64, address[], uint256[], uint8[], bool));
```

### 3.8 Reputación: _publishResolutionReputation (ya implementada)

```solidity
function _publishResolutionReputation(
    uint256 agentId,
    uint8 resolutionQuality,  // 0-100
    uint8 sourceQuality,      // 0-100
    uint8 analysisDepth       // 0-100
) internal {
    // ... (ver RewardsDistributor.sol líneas 1316-1350)
    // Publica 3 giveFeedback calls sin tag ACCURATE/INACCURATE
    // tag1 = "RESOLUTION_QUALITY" / "SOURCE_QUALITY" / "ANALYSIS_DEPTH"
    // tag2 = "" (vacío — no revela precisión)
}
```

---

## 4. Scoring Option 4: Multi-dimensional Blinded

### 4.1 Por Qué Option 4

| Aspecto | Opción 1 (Transparente) | Opción 4 (Blinded) |
|---------|------------------------|---------------------|
| Votos individuales | PÚBLICO | **Oculto** (solo en CRE TEE) |
| Quality scores | PÚBLICO (crudos) | **Pre-computados** en weights |
| Tag ACCURATE/INACCURATE | PÚBLICO | **No existe** |
| Dimensiones on-chain | 1 | **3** (sin precisión) |
| Verificabilidad | Total | Parcial (confianza en CRE) |
| Inferencia de votos | Trivial | **Ambigua** |

### 4.2 Qué Puede Ver un Observador On-chain

```
Worker A: weight=900000, Resolution Quality=90, Source Quality=85, Analysis Depth=80
Worker B: weight=100000, Resolution Quality=40, Source Quality=35, Analysis Depth=30
Resolution: YES

¿Worker A votó YES o NO? → NO SE PUEDE DETERMINAR con certeza
  - weight alto podría ser: buena calidad + acertó (200x)
  - O podría ser: calidad excelente + erró (50x) + reputación alta
  - La ambigüedad es intencional
```

### 4.3 Fórmula de Weights (computada off-chain por CRE)

```
weight[i] = qualityScore[i] × correctnessMult[i] × reputation[i]

donde:
  qualityScore:    0-100 (LLM evaluation in TEE)
  correctnessMult: 200 si determination[i] == resolution, 50 si no
  reputation:      0-100 (leído de ERC-8004, default 50 si nuevo)
```

### 4.4 Flujo Completo del Scoring

```
PASO 4 CRE (EVALUAR en TEE)                PASO 5 CRE (RESOLVER en TEE)
─────────────────────                       ──────────────────────
Por worker, evalúa 8 dimensiones:           Computa:
 • Initiative: 75        ← off-chain        peso = qualityAgregado × multCorrectitud × rep
 • Collaboration: 80     ← off-chain        dimScores = [resQuality, srcQuality, analysis]
 • Reasoning Depth: 85   ← off-chain
 • Compliance: 90        ← off-chain        CONFIDENCIAL (nunca sale del TEE):
 • Efficiency: 70        ← off-chain         determination = true/false
 • Resolution Quality: 88 ──────────► on-chain    correctnessMult = 200/50
 • Source Quality: 72      ──────────► on-chain    qualityScore crudo
 • Analysis Depth: 65      ──────────► on-chain
                                            PÚBLICO (on-chain):
                                             weights[] (blindados)
                                             dimScores[] (3 dims, sin precisión)
                                             resolution (respuesta final)
```

---

## 5. CRE Resolution Workflow

### 5.1 Estructura de Archivos

```
chaossettler/
└── cre-workflow/
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts          # Entry point, orchestrates 6 steps
        ├── types.ts          # TypeScript interfaces
        ├── step1-read.ts     # READ: workers, endpoints, reputations from chain
        ├── step2-ask.ts      # ASK: POST /a2a/resolve to each worker
        ├── step3-challenge.ts # CHALLENGE: generate + send challenge questions
        ├── step4-evaluate.ts # EVALUATE: score quality 0-100 per worker
        ├── step5-resolve.ts  # RESOLVE: weighted majority + blinded weights
        └── step6-write.ts    # WRITE: resolveAndDistribute on-chain
```

### 5.2 Tipos (types.ts)

```typescript
export interface WorkerInfo {
  address: string;
  agentId: bigint;
  stake: bigint;
  a2aEndpoint: string;
  reputation: number;   // 0-100
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
  qualityScore: number;       // 0-100 aggregate
  determination: boolean;      // stays off-chain
  resolutionQuality?: number;  // 0-100 dimension
  sourceQuality?: number;      // 0-100 dimension
  analysisDepth?: number;      // 0-100 dimension
}

export interface ResolutionResult {
  resolution: boolean;
  workers: string[];
  weights: number[];          // on-chain (blinded)
  dimScores: number[];        // on-chain (3 dims)
  determinations: boolean[];  // off-chain only
}
```

### 5.3 Los 6 Steps — Resumen

| Step | Nombre | Herramienta CRE | Input | Output |
|------|--------|-----------------|-------|--------|
| 1 | READ | EVMClient.read | Chain state | WorkerInfo[] |
| 2 | ASK | Confidential HTTP | Questions → workers | WorkerDetermination[] |
| 3 | CHALLENGE | Confidential HTTP + LLM | Contradictions → workers | ChallengeQA[] |
| 4 | EVALUATE | LLM (in TEE) | Evidence + challenges | WorkerEvaluation[] |
| 5 | RESOLVE | Pure compute | Evaluations | ResolutionResult |
| 6 | WRITE | runtime.report() / direct call | ResolutionResult | Tx receipt |

### 5.4 Step 5: Resolve (la más importante)

```typescript
export function resolve(evaluations: WorkerEvaluation[]): ResolutionResult {
  // --- Weighted majority vote ---
  let yesWeight = 0;
  let noWeight = 0;

  for (const ev of evaluations) {
    const weight = ev.qualityScore * ev.worker.reputation;
    if (ev.determination) yesWeight += weight;
    else noWeight += weight;
  }

  const resolution = yesWeight > noWeight;

  // --- Pre-compute blinded weights (Option 4) ---
  const ACCURATE_MULT = 200;
  const INACCURATE_MULT = 50;

  const workers: string[] = [];
  const weights: number[] = [];
  const dimScores: number[] = [];
  const determinations: boolean[] = [];  // OFF-CHAIN only

  for (const ev of evaluations) {
    const correctnessMult =
      ev.determination === resolution ? ACCURATE_MULT : INACCURATE_MULT;

    workers.push(ev.worker.address);
    weights.push(ev.qualityScore * correctnessMult * ev.worker.reputation);
    determinations.push(ev.determination);

    dimScores.push(ev.resolutionQuality ?? ev.qualityScore);
    dimScores.push(ev.sourceQuality ?? Math.round(ev.qualityScore * 0.8));
    dimScores.push(ev.analysisDepth ?? Math.round(ev.qualityScore * 0.7));
  }

  return { resolution, workers, weights, dimScores, determinations };
}
```

### 5.5 Step 6: Write (dos modos)

**Modo CRE (producción)**:
```typescript
import { runtime } from '@chainlink/cre-sdk';

const payload = encodeResolutionReport(studio, epoch, result);
runtime.report(payload);  // DON signs → KeystoneForwarder → CREReceiver → resolveAndDistribute
```

**Modo local (demo)**:
```typescript
const contract = new ethers.Contract(rewardsDistributorAddress, ABI, creSigner);
await contract.resolveAndDistribute(
  studioAddress, epoch, result.workers, result.weights, result.dimScores, result.resolution
);
```

> **Código completo de todos los steps**: Ver `IMPLEMENTATION_GUIDE.md` §cre-workflow

---

## 6. Worker Agent (Python/FastAPI)

### 6.1 Estructura

```
chaossettler/
└── agent/
    ├── requirements.txt
    ├── Dockerfile
    ├── src/
    │   ├── main.py           # FastAPI app
    │   ├── config.py         # Environment config
    │   ├── routes/
    │   │   └── a2a.py        # /a2a/resolve + /a2a/challenge
    │   └── services/
    │       ├── investigator.py  # LLM-based investigation
    │       └── defender.py      # Challenge defense
    └── tests/
        ├── test_resolve.py
        └── test_challenge.py
```

### 6.2 Endpoints A2A

```
POST /a2a/resolve
  Request:  { market_id: str, question: str, deadline?: int, context?: str }
  Response: { determination: bool, confidence: float, evidence: str, sources: str[] }

POST /a2a/challenge
  Request:  { challenges: str[] }
  Response: { responses: str[] }

GET /health
  Response: { status: "ok", agent: str }
```

### 6.3 Cómo Investiga

```python
# investigator.py (simplificado)
async def investigate(question: str, context: str | None) -> dict:
    if not client:  # Sin API key → mock deterministic
        return _mock_investigation(question)

    # Con LLM:
    system_prompt = """You are a decentralized oracle agent...
    Respond in JSON: { determination, confidence, evidence, sources }"""

    response = await client.chat.completions.create(
        model=LLM_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Question: {question}"},
        ],
        temperature=0,
        response_format={"type": "json_object"},
    )
    return json.loads(response.choices[0].message.content)
```

### 6.4 Mock para Testing

Sin API key, el worker usa respuestas deterministas basadas en keywords:
- `"bitcoin" + "200k"` → False, confidence 0.65
- `"ethereum" + "pos"` → True, confidence 0.99
- Default → hash-based deterministic (SHA256 del question)

> **Código completo del worker agent**: Ver `IMPLEMENTATION_GUIDE.md` §Agent

---

## 7. Scripts de Setup y Demo

### 7.1 register-worker.ts

```
Uso: ts-node register-worker.ts <WORKER_KEY> <STUDIO_PROXY> [STAKE_ETH]

1. Minta ERC-8004 identity NFT
2. Registra en StudioProxy con stake (default 0.01 ETH)
```

### 7.2 create-market.ts

```
Uso: ts-node create-market.ts <QUESTION> [REWARD_ETH] [DURATION_DAYS]

1. Llama createMarket() en StudioProxy (via ResolutionMarketLogic)
2. Emite MarketCreated event con marketId
```

### 7.3 setup-demo.ts

```
1. Deploy contratos (o lee addresses de .env)
2. Registra 3 workers (A, B, C)
3. Deposita reward pool
4. Crea 1 mercado de prueba
```

### 7.4 demo-run.ts — Full Loop de 3 Mercados

```
MERCADO 1: "¿Aprobará la SEC un ETF de Solana antes de julio 2026?"
─────────────────────────────────────────────────────────────────────
Worker A: quality=90, accurate  → feedback: ResQuality=90
Worker B: quality=80, accurate  → feedback: ResQuality=80
Worker C: quality=20, wrong     → feedback: ResQuality=20

Después: rep(A)≈90, rep(B)≈80, rep(C)≈20

MERCADO 2: "¿Superará Bitcoin los $200k antes de abril 2026?"
──────────────────────────────────────────────────────────────
Worker A: quality=85, accurate  → rep(A) = avg(90,85) ≈ 87
Worker C: quality=25, wrong     → rep(C) = avg(20,25) ≈ 22
Worker D: quality=70, accurate  → rep(D) = 70 (primer mercado)

MERCADO 3: "¿Lanzará Apple un dispositivo AR antes de junio 2026?"
───────────────────────────────────────────────────────────────────
Worker A: quality=80, reputation=87 → PESO ALTO en resolución
Worker C: quality=60, reputation=22 → peso bajo (historial malo)
Worker D: quality=75, reputation=70 → peso medio

→ A tiene más influencia en la resolución Y gana más reward
→ C necesita muchos mercados buenos para recuperar su reputación
→ ESTO es lo que mostramos en la demo: reputation compounds
```

> **Código completo de scripts**: Ver `IMPLEMENTATION_GUIDE.md` §Scripts

---

## 8. Flujo de Fondos

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ═══════ SETUP ═══════                                                     │
│                                                                             │
│  Creador ──deposit{1 ETH}──> StudioProxy._totalEscrow = 1 ETH             │
│  Worker A ─registerAgent{0.01 ETH}─> stake stored                          │
│  Worker B ─registerAgent{0.01 ETH}─> stake stored                          │
│                                                                             │
│  StudioProxy._totalEscrow = 1.02 ETH (reward + stakes)                    │
│                                                                             │
│  ═══════ RESOLUTION ═══════                                                │
│                                                                             │
│  CRE calls resolveAndDistribute():                                         │
│    totalEscrow = 1.02 ETH                                                  │
│    totalStakes = 0.02 ETH (A: 0.01 + B: 0.01)                             │
│    rewardPool  = 1.00 ETH                                                  │
│    totalWeight = 900000 + 100000 = 1,000,000                               │
│                                                                             │
│    Worker A: reward = 1.0 × 900000/1000000 = 0.90 ETH                     │
│              + stake back = 0.01 ETH                                       │
│              → withdrawable = 0.91 ETH                                     │
│                                                                             │
│    Worker B: reward = 1.0 × 100000/1000000 = 0.10 ETH                     │
│              + stake back = 0.01 ETH                                       │
│              → withdrawable = 0.11 ETH                                     │
│                                                                             │
│  ═══════ WITHDRAW ═══════                                                  │
│                                                                             │
│  Worker A → withdraw() → receives 0.91 ETH                                │
│  Worker B → withdraw() → receives 0.11 ETH                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 9. Seguridad

| Amenaza | Defensa |
|---------|---------|
| CRE comprometido envía addresses falsas | `resolveAndDistribute()` valida que cada worker esté registrado (`getAgentId != 0`) |
| Worker registra y no participa | Recibe reward bajo (quality≈0 del LLM). Stake se devuelve pero gana ~0 reward |
| CRE no resuelve nunca | ResolutionMarketLogic puede implementar `timeout()` para devolver fondos |
| Reentrancy en withdraw | Pull payment pattern en StudioProxy |
| Worker se registra 2 veces | StudioProxy.registerAgent reverts on duplicate |
| Más de 10 workers | `require(workers.length <= 10)` en resolveAndDistribute |
| Double-call resolveAndDistribute | `_epochResolved[studio][epoch]` guard (§3.4) |
| submitConsensus después de timeout | `require(!_epochResolved[studio][epoch])` |
| Inferencia de votos por ratio de reward | Con ≥3 workers, múltiples combinaciones producen el mismo ratio. Con Private Tx, montos ocultos. |

---

## 10. Privacy Track (Chainlink Hackathon)

### 10.1 Confidential HTTP (ya incluido por usar CRE)

| Dato | Dónde vive | Privado |
|------|-----------|---------|
| Determinación de cada worker | TEE de CRE | SI |
| Evidencia y fuentes | TEE de CRE | SI |
| Challenge Q&A | TEE de CRE | SI |
| Scores crudos (8 dims) | TEE de CRE | SI |
| Multiplicador correctitud | TEE de CRE | SI |
| API keys del LLM | TEE de CRE | SI |

### 10.2 Private Transactions (nice-to-have, disponible desde Feb 16)

| Dato | Sin Private Tx | Con Private Tx |
|------|---------------|----------------|
| Quién recibió reward | PÚBLICO (evento) | **PRIVADO** |
| Cuánto recibió | PÚBLICO (calldata) | **PRIVADO** |
| Distribución proporcional | PÚBLICO | **PRIVADO** |

### 10.3 Modelo Completo

```
┌──────────────────────────────────────────────────────────────┐
│  CRE TEE (Confidential HTTP + Compute)                       │
│                                                              │
│  SECRETO: votos, evidencia, scores crudos, multCorrectitud  │
│                                                              │
│  Produce:                                                    │
│   • weights[] (blindados)                                    │
│   • dimScores[] (3 dimensiones, sin tag de precisión)        │
│   • resolution (respuesta del mercado)                       │
└──────────┬───────────────────────────┬───────────────────────┘
           │                           │
    ┌──────▼──────────┐      ┌─────────▼──────────────┐
    │  REPUTACIÓN      │      │  PAGOS                  │
    │  (pública)       │      │  (Private Tx opcional)  │
    │                  │      │                         │
    │  ResQuality=85   │      │  Worker A: ??? ETH      │
    │  SrcQuality=72   │      │  Worker B: ??? ETH      │
    │  Analysis=65     │      │  (montos ocultos)       │
    │                  │      │                         │
    │  Consultable     │      │  No consultable         │
    │  por cualquiera  │      │  por observadores       │
    └──────────────────┘      └─────────────────────────┘
```

---

## 11. Qué Construimos (Resumen Ejecutivo)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  CONTRATOS SOLIDITY (branch hackathon/chaos-settler)                       │
│  ═══════════════════════════════════════════════════                        │
│  ✅ RewardsDistributor.sol — resolveAndDistribute Option 4 Blinded         │
│  ✅ ResolutionMarketLogic.sol — LogicModule con createMarket, 8 dims       │
│  ⬜ CREReceiver.sol — puente KeystoneForwarder (~65 líneas)                │
│  ⬜ _epochResolved guard (~3 líneas en RewardsDistributor)                 │
│  ⬜ Tests: ResolveAndDistribute.t.sol, CREReceiver.t.sol,                  │
│     ResolutionMarketLogic.t.sol (~420 líneas)                              │
│  ⬜ Deploy: DeployChaosSettler.s.sol (~100 líneas)                         │
│                                                                             │
│  CRE WORKFLOW (repo chaossettler/, TypeScript)                             │
│  ═════════════════════════════════════════════                              │
│  ⬜ types.ts + step1..6.ts + index.ts (~585 líneas)                        │
│  ⬜ Compila a WASM para DON                                                │
│  ⬜ Local demo mode (direct call)                                          │
│                                                                             │
│  WORKER AGENT (repo chaossettler/, Python/FastAPI)                         │
│  ═══════════════════════════════════════════════                            │
│  ⬜ /a2a/resolve + /a2a/challenge (~250 líneas)                            │
│  ⬜ Mock mode (sin API key) + LLM mode                                     │
│  ⬜ Tests (~60 líneas)                                                     │
│                                                                             │
│  SCRIPTS (repo chaossettler/, TypeScript)                                  │
│  ═══════════════════════════════════════                                    │
│  ⬜ register-worker.ts, create-market.ts (~200 líneas)                     │
│  ⬜ setup-demo.ts, demo-run.ts (~140 líneas)                               │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────         │
│  TOTAL: ~1,823 líneas nuevas + ~1,350 ya escritas                          │
│  HACKATHON TRACKS: Prediction Markets + Privacy                            │
│  ─────────────────────────────────────────────────────────────────         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 12. Plan de Implementación Paso a Paso

### Fase 1: Contratos (2-3 días)

| Paso | Qué | Referencia |
|------|-----|-----------|
| 1 | Agregar `_epochResolved` guard a RewardsDistributor.sol | §3.4 |
| 2 | Escribir `CREReceiver.sol` completo | §3.5 / IMPL_GUIDE §C |
| 3 | Escribir `ResolveAndDistribute.t.sol` | IMPL_GUIDE §E |
| 4 | Escribir `CREReceiver.t.sol` | IMPL_GUIDE §D |
| 5 | Escribir `ResolutionMarketLogic.t.sol` | IMPL_GUIDE §F |
| 6 | Validar: `forge build && forge test` | — |
| 7 | Escribir `DeployChaosSettler.s.sol` | IMPL_GUIDE §G |
| 8 | Commit Fase 1 | — |

### Fase 2: Worker Agent + CRE Workflow (3-4 días)

| Paso | Qué | Referencia |
|------|-----|-----------|
| 9 | Crear repo `chaossettler/` con estructura | IMPL_GUIDE §Part 2 |
| 10 | Worker Agent: main.py, a2a.py, investigator.py, defender.py | IMPL_GUIDE §Agent |
| 11 | Worker Agent: tests | IMPL_GUIDE §Agent/tests |
| 12 | CRE Workflow: types.ts, step1..6.ts, index.ts | IMPL_GUIDE §CRE Workflow |
| 13 | Scripts: register-worker.ts, create-market.ts | IMPL_GUIDE §Scripts |
| 14 | Validar: worker agent responde, CRE workflow ejecuta local | — |

### Fase 3: Integración E2E (2-3 días)

| Paso | Qué |
|------|-----|
| 15 | Deploy en Anvil local (puerto 8546) |
| 16 | Levantar 3 worker agents (puertos 8001, 8002, 8003) |
| 17 | Ejecutar CRE workflow contra Anvil |
| 18 | Validar: rewards distribuidos, reputación publicada |
| 19 | Demo: 3 mercados mostrando reputación acumulada |

### Fase 4: Polish + Submission (2-3 días)

| Paso | Qué |
|------|-----|
| 20 | Deploy en Base Sepolia (si CRE DON disponible) |
| 21 | Documentar: README, arquitectura, screenshots |
| 22 | Video demo |
| 23 | Submit hackathon |

---

## 13. Dependencias y Puertos

### Puertos

| Servicio | Puerto | Notas |
|----------|--------|-------|
| Anvil (local testnet) | 8546 | **NO 8545** (Docker puede ocuparlo) |
| Worker Agent A | 8001 | `AGENT_PORT=8001` |
| Worker Agent B | 8002 | `AGENT_PORT=8002` |
| Worker Agent C | 8003 | `AGENT_PORT=8003` |

### Keys de Anvil (para demo)

```bash
# Deployer / Admin
DEPLOYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

# CRE DON Signer (simulates resolver)
CRE_DON_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d

# Workers
WORKER_A_KEY=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
WORKER_B_KEY=0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6
WORKER_C_KEY=0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a
```

### Package Manager

**YARN** (no npm, no pnpm).

---

## 14. Checklist de Validación

### Contratos

- [ ] `forge build --skip script test` → compila sin errores
- [ ] `forge test` → todos los tests pasan
- [ ] `forge test --match-contract ResolveAndDistributeTest -vvv` → happy path + edge cases
- [ ] `forge test --match-contract CREReceiverTest -vvv` → onReport + auth
- [ ] `forge test --match-contract ResolutionMarketLogicTest -vvv` → createMarket + scoring

### Worker Agent

- [ ] `pytest agent/tests/` → tests pasan
- [ ] `curl http://localhost:8001/health` → `{"status": "ok"}`
- [ ] `curl -X POST http://localhost:8001/a2a/resolve -d '{"market_id":"test","question":"test?"}' -H 'Content-Type: application/json'` → determination + evidence

### CRE Workflow (local demo)

- [ ] Anvil running en 8546
- [ ] Workers registered en StudioProxy
- [ ] `ts-node cre-workflow/src/index.ts 1 "Test question?"` → resolution completada
- [ ] Workers tienen withdrawable balance > 0

### Demo 3 Mercados

- [ ] Mercado 1 resuelto → reputación publicada
- [ ] Mercado 2 resuelto → reputación actualizada (average)
- [ ] Mercado 3 resuelto → worker con alta rep tiene más peso
- [ ] Rewards reflejan calidad × correctitud × reputación

---

## 15. Referencias

| Documento | Path | Contenido |
|-----------|------|-----------|
| IMPLEMENTATION_GUIDE | `hackathon/IMPLEMENTATION_GUIDE.md` | Todo el código a escribir (~2937 líneas) |
| SCORING_CONFIDENTIALITY | `hackathon/SCORING_CONFIDENTIALITY_ANALYSIS.md` | 4 opciones de scoring, Option 4 recomendada |
| v13 (original) | `hackathon/v13_standalone_baseline.md` | Diseño standalone original (pre-blinded) |
| v14 | `hackathon/v14_chaoschain_integration.md` | Justificación de usar ChaosChain |
| ANALISIS 14FEB | `hackathon/ANALISIS)CHAOS_14FEB.md` | closeEpoch vs resolveAndDistribute + bug double-call |
| RewardsDistributor | `packages/contracts/src/RewardsDistributor.sol` | Contrato ya modificado |
| ResolutionMarketLogic | `packages/contracts/src/logic/ResolutionMarketLogic.sol` | LogicModule ya implementado |
