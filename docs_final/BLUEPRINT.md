# CREsolver — Blueprint

> **Estado**: Fases 1-3 completadas. Fase 4 (Polish + Deploy) pendiente.
>
> **Decisiones incorporadas**:
> - Option 4: Multi-dimensional Blinded (`weights[]` + `dimScores[]`, sin `determinations[]` on-chain)
> - 3 dimensiones on-chain: Resolution Quality, Source Quality, Analysis Depth
> - 5 dimensiones PoA off-chain (evaluadas en CRE TEE, no publicadas)
> - Workers son oráculos descentralizados de IA (no predicen, investigan)
> - CRE DON es el evaluador imparcial (no hay verifiers separados)
> - Challenge Q&A no se persiste (CRE stateless = privacidad)
>
> **Standalone**: CREsolver es autónomo. `CREsolverMarket.sol` integra mercados,
> staking, escrow, resolución y reputación en un solo contrato.
>
> **Todo el código a escribir está en este documento + IMPLEMENTATION_GUIDE.md**

---

## 1. Arquitectura

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  COMPONENTES                                                               │
│                                                                             │
│  A. Contratos Solidity (cresolver/contracts/)                              │
│     ├── CREsolverMarket.sol    — Mercado + staking + escrow + reputación   │
│     ├── CREReceiver.sol        — Puente KeystoneForwarder → resolveMarket  │
│     ├── ReceiverTemplate.sol   — Base contract CRE receiver pattern        │
│     ├── IReceiver.sol          — Interface ERC165 para receivers           │
│     └── Tests + Deploy script  — ✅ COMPLETADO                             │
│                                                                             │
│  B. CRE Resolution Workflow (TypeScript) ✅ COMPLETADO                     │
│     ├── 6 steps: READ → ASK → CHALLENGE → EVALUATE → RESOLVE → WRITE     │
│     ├── Compila a WASM para ejecutar en DON (pendiente)                    │
│     └── Local demo mode: llama resolveMarket directamente                  │
│                                                                             │
│  C. Worker Agent (TypeScript/Hono) ✅ COMPLETADO                           │
│     ├── POST /a2a/resolve  — investiga y determina outcome                 │
│     ├── POST /a2a/challenge — defiende su determinación                    │
│     └── Mock + LLM modes                                                   │
│                                                                             │
│  D. Scripts (TypeScript) ✅ COMPLETADO                                     │
│     ├── setup-demo.ts      — Deploy + setup + register workers             │
│     └── demo-run.ts        — Full loop con 3 mercados                      │
│                                                                             │
│  E. E2E Sandbox (Docker Compose) ✅ COMPLETADO                             │
│     ├── docker-compose.e2e.yml — Anvil + 3 agents                          │
│     ├── e2e/setup.ts — Deploy, fund, create markets, join                  │
│     ├── e2e/e2e.test.ts — 12 tests (3 markets + edge cases)               │
│     └── yarn e2e — one-command: up → setup → test → down                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Flujo Completo End-to-End

El siguiente diagrama muestra las 5 fases del ciclo de vida de un mercado CREsolver,
incluyendo la integración opcional con ERC-8004 IdentityRegistry y ReputationRegistry.

### Fase 1: Setup

```
┌──────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐
│ Deployer │    │ ERC-8004     │    │ CREsolver    │    │ Workers          │
│          │    │ Identity     │    │ Market       │    │ (Agents)         │
│          │    │ (optional)   │    │              │    │                  │
└────┬─────┘    └──────┬───────┘    └──────┬───────┘    └────────┬─────────┘
     │                 │                   │                     │
     │  deploy(identityReg, reputationReg) │                     │
     │────────────────────────────────────>│                     │
     │                 │                   │                     │
     │  Creador: createMarket{value, question, duration}        │
     │────────────────────────────────────>│                     │
     │  ← marketId     │                   │                     │
     │                 │                   │                     │
     │                 │  (si ERC-8004)    │                     │
     │                 │  register()       │                     │
     │                 │<─────────────────────────────────────── │
     │                 │  ← agentId        │                     │
     │                 │                   │                     │
     │                 │                   │  joinMarket(marketId, agentId)
     │                 │                   │<────────────────────│
     │                 │  isAuthorizedOrOwner(worker, agentId)?  │
     │                 │<──────────────────│                     │
     │                 │──true────────────>│                     │
     │                 │                   │  ← stake locked     │
     │                 │                   │                     │
```

- **ERC-8004 Identity** es opcional: si `identityRegistry == address(0)`, `joinMarket` acepta cualquier address con `agentId=0`
- Si está habilitado, el contrato verifica `isAuthorizedOrOwner(msg.sender, agentId)` y almacena el mapping `workerAgentIds[marketId][worker] = agentId`

### Fase 2: Trigger

```
┌──────────┐    ┌──────────────┐    ┌──────────────┐
│ Creador  │    │ CREsolver    │    │ CRE EVM      │
│ / Owner  │    │ Market       │    │ Log Trigger   │
└────┬─────┘    └──────┬───────┘    └──────┬────────┘
     │                 │                   │
     │  requestResolution(marketId)        │
     │────────────────>│                   │
     │                 │                   │
     │                 │  emit ResolutionRequested(marketId, question)
     │                 │──────────────────>│
     │                 │                   │  triggers CRE workflow
     │                 │                   │
```

### Fase 3: Resolution (CRE TEE) — Pipeline de 6 Steps

```
┌──────────┐  ┌──────────┐  ┌──────────────────────────────────────────────┐
│ Worker A │  │ Worker B │  │              CRE DON (TEE)                    │
│ (Agent)  │  │ (Agent)  │  │                                              │
└────┬─────┘  └────┬─────┘  │  ┌─────────────────────────────────────────┐ │
     │              │        │  │ Step 1: READ                            │ │
     │              │        │  │  → getMarket(), getMarketWorkers()      │ │
     │              │        │  │  → stakes[], reputation[] from chain    │ │
     │              │        │  └─────────────────────────────────────────┘ │
     │              │        │                                              │
     │              │        │  ┌─────────────────────────────────────────┐ │
     │              │        │  │ Step 2: ASK (Confidential HTTP)         │ │
     │  POST /a2a/resolve    │  │  Cada worker es consultado              │ │
     │<──────────────────────│  │  INDIVIDUALMENTE — los workers          │ │
     │  {determination,      │  │  NO pueden ver las respuestas           │ │
     │   evidence, sources}  │  │  de otros workers.                      │ │
     │              │        │  │                                          │ │
     │              │  POST /a2a/resolve                                    │
     │              │<───────│  │  Privacy: agent A no sabe qué           │ │
     │              │        │  │  respondió agent B (y viceversa)        │ │
     │              │        │  └─────────────────────────────────────────┘ │
     │              │        │                                              │
     │              │        │  ┌─────────────────────────────────────────┐ │
     │              │        │  │ Step 3: CHALLENGE                       │ │
     │  POST /a2a/challenge  │  │  Genera preguntas basadas en            │ │
     │<──────────────────────│  │  desacuerdos entre workers              │ │
     │  {responses}  │       │  │  (sin revelar quién dijo qué)           │ │
     │              │  POST /a2a/challenge                                  │
     │              │<───────│  │                                          │ │
     │              │        │  └─────────────────────────────────────────┘ │
     │              │        │                                              │
     │              │        │  ┌─────────────────────────────────────────┐ │
     │              │        │  │ Step 4: EVALUATE (in TEE)               │ │
     │              │        │  │  Por worker evalúa 3 dimensiones:       │ │
     │              │        │  │  • Resolution Quality (0-100)           │ │
     │              │        │  │  • Source Quality (0-100)               │ │
     │              │        │  │  • Analysis Depth (0-100)               │ │
     │              │        │  │  qualityScore = resQ×0.4 + srcQ×0.3    │ │
     │              │        │  │                + analysis×0.3           │ │
     │              │        │  └─────────────────────────────────────────┘ │
     │              │        │                                              │
     │              │        │  ┌─────────────────────────────────────────┐ │
     │              │        │  │ Step 5: RESOLVE (in TEE)                │ │
     │              │        │  │  Weighted majority vote:                │ │
     │              │        │  │  voteWeight = quality × repFactor       │ │
     │              │        │  │  resolution = yesWeight >= noWeight     │ │
     │              │        │  │                                          │ │
     │              │        │  │  Blinded weights (for on-chain):        │ │
     │              │        │  │  weight = quality × correctMult × rep   │ │
     │              │        │  │  (correctMult: 200 if correct, 50 if    │ │
     │              │        │  │   not — NEVER leaves TEE)               │ │
     │              │        │  └─────────────────────────────────────────┘ │
     │              │        │                                              │
     │              │        │  ┌─────────────────────────────────────────┐ │
     │              │        │  │ Step 6: WRITE                           │ │
     │              │        │  │  runtime.report() → DON signs           │ │
     │              │        │  │  → KeystoneForwarder → CREReceiver      │ │
     │              │        │  │  → resolveMarket()                      │ │
     │              │        │  └─────────────────────────────────────────┘ │
     │              │        └──────────────────────────────────────────────┘
```

**Modelo de Privacidad**: Todo dentro del TEE es confidencial — votos individuales, evidencia, scores crudos, y el multiplicador de correctitud nunca salen del TEE. On-chain solo aparecen: `weights[]` (blindados), `dimScores[]` (3 dimensiones), y `resolution` (respuesta final).

### Fase 4: Settlement

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ CRE DON      │    │ Keystone     │    │ CREReceiver  │    │ CREsolver    │
│ (TEE)        │    │ Forwarder    │    │              │    │ Market       │
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘    └──────┬───────┘
       │                   │                   │                   │
       │ runtime.report()  │                   │                   │
       │  (DON-signed)     │                   │                   │
       │──────────────────>│                   │                   │
       │                   │  onReport(meta, report)               │
       │                   │──────────────────>│                   │
       │                   │                   │  decode report    │
       │                   │                   │  resolveMarket()  │
       │                   │                   │──────────────────>│
       │                   │                   │                   │
       │                   │                   │                   │  ┌─────────────────┐
       │                   │                   │                   │  │ 1. Distribute    │
       │                   │                   │                   │  │    rewards       │
       │                   │                   │                   │  │ 2. Return stakes │
       │                   │                   │                   │  │ 3. Update        │
       │                   │                   │                   │  │    internal rep   │
       │                   │                   │                   │  │ 4. ERC-8004      │
       │                   │                   │                   │  │    giveFeedback() │
       │                   │                   │                   │  │    (if configured)│
       │                   │                   │                   │  └─────────────────┘
       │                   │                   │                   │
```

- **ERC-8004 Feedback**: Si `reputationRegistry != address(0)` y el worker tiene `agentId > 0`, se publica `giveFeedback(agentId, avgScore, 0, "resolution", "cresolver", ...)` al ReputationRegistry
- El `avgScore` es el promedio de las 3 dimensiones: `(resQuality + srcQuality + analysisDepth) / 3`
- La reputación interna (`getReputation()`) sigue siendo la fuente rápida para el workflow; ERC-8004 es la reputación canónica externa

### Fase 5: Withdraw

```
┌──────────┐    ┌──────────────┐
│ Worker   │    │ CREsolver    │
│          │    │ Market       │
└────┬─────┘    └──────┬───────┘
     │                 │
     │  withdraw()     │
     │────────────────>│
     │                 │  balances[worker] → 0
     │  ← reward + stake (ETH transfer)
     │                 │
```

### ERC-8004 Addresses (Ethereum Sepolia)

| Registry | Address |
|----------|---------|
| IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

Para deploy en Sepolia con ERC-8004 habilitado:
```bash
ERC8004_IDENTITY=0x8004A818BFB912233c491871b3d84c89A494BD9e \
ERC8004_REPUTATION=0x8004B663056A597Dffe9eCcC1965A193B7388713 \
forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC --broadcast
```

---

## 3. Contratos Solidity

### 3.1 CREsolverMarket.sol — Contrato Principal

**Archivo**: `contracts/src/CREsolverMarket.sol`

Contrato standalone que combina toda la lógica en un solo contrato:

| Función | Descripción |
|---------|-------------|
| `createMarket(question, duration)` | Crea mercado con reward pool (msg.value) |
| `joinMarket(marketId, agentId)` | Worker stakea ETH para participar (ERC-8004 identity check si configurado) |
| `resolveMarket(marketId, workers, weights, dimScores, resolution)` | Resuelve y distribuye rewards |
| `requestResolution(marketId)` | Emite evento para CRE EVM Log Trigger |
| `withdraw()` | Worker retira balance acumulado |
| `setAuthorizedResolver(resolver, authorized)` | Owner autoriza/revoca resolvers |
| `getMarket(marketId)` | Lee datos del mercado |
| `getMarketWorkers(marketId)` | Lista workers de un mercado |
| `getReputation(worker)` | Lee reputación promediada |
| `getScoringCriteria()` | Devuelve 8 dimensiones de evaluación y pesos |

**Structs**:

```solidity
struct Market {
    string question;
    uint256 rewardPool;
    uint256 deadline;
    address creator;
    bool resolved;
}

struct Reputation {
    uint256 resQualitySum;
    uint256 srcQualitySum;
    uint256 analysisDepthSum;
    uint256 count;
}
```

**Firma de resolveMarket** (la función central):

```solidity
function resolveMarket(
    uint256 marketId,
    address[] calldata workers,  // Worker addresses (max 10)
    uint256[] calldata weights,  // Pre-computed blinded weights
    uint8[] calldata dimScores,  // Flat: [w0_resQ, w0_srcQ, w0_analysis, w1_resQ, ...]
    bool resolution              // Final weighted answer (true/false)
) external
```

**Qué hace resolveMarket**:
1. Valida inputs (market exists, not resolved, arrays match, workers registered, caller authorized)
2. Calcula `totalWeight = sum(weights)`
3. Por cada worker: `reward = rewardPool × weight[i] / totalWeight`, más devuelve stake
4. Acumula 3 dimensiones de reputación (promedio running)
5. Marca mercado como resolved

**Qué NO hace**:
- NO recibe `determinations[]` (votos se quedan en CRE TEE)
- NO calcula consenso (CRE lo hace off-chain)
- NO distribuye a validadores (CRE es el evaluador)

### 3.2 CREReceiver.sol — Puente DON → Market

**Archivo**: `contracts/src/CREReceiver.sol`

```solidity
contract CREReceiver is ReceiverTemplate {
    ICREsolverMarket public immutable market;

    constructor(address _market, address _forwarder) ReceiverTemplate(_forwarder) {
        market = ICREsolverMarket(_market);
    }

    function _processReport(bytes calldata report) internal override {
        (
            uint256 marketId,
            address[] memory workers,
            uint256[] memory weights,
            uint8[] memory dimScores,
            bool resolution
        ) = abi.decode(report, (uint256, address[], uint256[], uint8[], bool));

        market.resolveMarket(marketId, workers, weights, dimScores, resolution);
        emit ReportReceived(bytes32(0), marketId);
    }
}
```

### 3.3 ReceiverTemplate.sol — Base Contract

**Archivo**: `contracts/src/interfaces/ReceiverTemplate.sol`

Contrato base abstracto que implementa el patrón CRE receiver:

1. Valida que `msg.sender == forwarder` (KeystoneForwarder)
2. Decodifica metadata (workflowId, donId, workflowOwner)
3. Opcionalmente enforza workflow identity (whitelist de workflows permitidos)
4. Delega a `_processReport()` para lógica de aplicación

**Funciones admin**:
- `setForwarder(address)` — Cambia el forwarder
- `allowWorkflow(workflowId, donId, name)` — Permite un workflow específico
- `disallowWorkflow(workflowId, donId)` — Revoca un workflow
- `setEnforceWorkflowIdentity(bool)` — Activa/desactiva enforcement

### 3.4 KeystoneForwarder Pattern

```
CRE Workflow         CRE Runtime         KeystoneForwarder        CREReceiver         CREsolverMarket
     │                    │                      │                      │                      │
     │──runtime.report()─>│                      │                      │                      │
     │  (encoded payload) │──report()────────────>│                      │                      │
     │                    │  (DON-signed)         │──onReport(meta,rpt)─>│                      │
     │                    │                      │                      │──decode report────────│
     │                    │                      │                      │──resolveMarket()─────>│
     │                    │                      │                      │<──ok──────────────────│
     │                    │                      │<──ok─────────────────│                      │
```

**Authorization chain**:
1. KeystoneForwarder calls `CREReceiver.onReport()` → msg.sender = KeystoneForwarder
2. ReceiverTemplate valida forwarder + optional workflow identity
3. CREReceiver calls `CREsolverMarket.resolveMarket()` → msg.sender = CREReceiver
4. `setAuthorizedResolver(address(creReceiver), true)` authorizes the CREReceiver

### 3.5 Report Encoding (CRE → CREReceiver)

```solidity
// What CRE workflow encodes in evm.ts (submitResolution):
bytes memory report = abi.encode(
    marketId,    // uint256
    workers,     // address[]
    weights,     // uint256[]  ← blinded: quality × correctnessMult × rep
    dimScores,   // uint8[]    ← flat: [resQ, srcQ, analysis] per worker
    resolution   // bool
);

// What CREReceiver._processReport() decodes:
(uint256 marketId, address[] memory workers,
 uint256[] memory weights, uint8[] memory dimScores, bool resolution)
    = abi.decode(report, (uint256, address[], uint256[], uint8[], bool));
```

### 3.6 Deploy Script

```solidity
contract DeployScript is Script {
    function run() external {
        address identityReg = vm.envOr("ERC8004_IDENTITY", address(0));
        address reputationReg = vm.envOr("ERC8004_REPUTATION", address(0));

        // 1. Deploy CREsolverMarket (ERC-8004 registries optional)
        CREsolverMarket market = new CREsolverMarket(identityReg, reputationReg);

        // 2. Deploy CREReceiver (pointing to market + forwarder)
        CREReceiver receiver = new CREReceiver(address(market), keystoneForwarder);

        // 3. Authorize CREReceiver as resolver
        market.setAuthorizedResolver(address(receiver), true);

        // 4. Optionally authorize direct resolver for local demo
        if (directResolver != address(0)) {
            market.setAuthorizedResolver(directResolver, true);
        }
    }
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
weight[i] = qualityScore[i] × correctnessMult[i] × reputationFactor[i]

donde:
  qualityScore:     0-100 (evaluación algorítmica en workflow)
  correctnessMult:  200 si determination[i] == resolution, 50 si no
  reputationFactor: (avgReputation / 100 + 0.5) si count > 0, else 1.0
```

### 4.4 Flujo Completo del Scoring

```
PASO 4 CRE (EVALUAR en TEE)                PASO 5 CRE (RESOLVER en TEE)
─────────────────────                       ──────────────────────
Por worker, evalúa 3 dimensiones:           Computa:
 • Resolution Quality: 88 ──────────► on-chain    peso = quality × multCorrectitud × rep
 • Source Quality: 72      ──────────► on-chain    dimScores = [resQuality, srcQuality, analysis]
 • Analysis Depth: 65      ──────────► on-chain

  qualityScore = resQ×0.4 + srcQ×0.3       CONFIDENCIAL (nunca sale del TEE):
                 + analysis×0.3              determination = true/false
                                             correctnessMult = 200/50
                                             qualityScore crudo

                                            PÚBLICO (on-chain):
                                             weights[] (blindados)
                                             dimScores[] (3 dims, sin precisión)
                                             resolution (respuesta final)
```

---

## 5. CRE Resolution Workflow

### 5.1 Estructura de Archivos

```
cresolver/
└── cre-workflow/
    ├── project.yaml               # CRE project metadata
    ├── secrets.yaml               # API keys (no committed)
    └── cresolver-resolution/
        ├── workflow.yaml          # Workflow definition
        ├── config.json            # Agent endpoints + EVM config
        ├── main.ts                # Entry point, 2 triggers
        ├── types.ts               # Zod schemas + TypeScript interfaces
        ├── agents.ts              # HTTP client for worker queries
        ├── evm.ts                 # EVM client for on-chain reads/writes
        └── evaluate.ts            # Scoring + consensus + challenge gen
```

### 5.2 Tipos (types.ts)

```typescript
export interface WorkerData {
  address: string;
  endpoint: string;
  stake: bigint;
  reputation: {
    resQuality: number;
    srcQuality: number;
    analysisDepth: number;
    count: number;
  };
}

export interface WorkerDetermination extends AgentResolveResponse {
  workerAddress: string;
}

export interface ChallengeResult {
  workerAddress: string;
  challenges: string[];
  responses: string[];
}

export interface WorkerEvaluation {
  workerAddress: string;
  qualityScore: number;
  resolutionQuality: number;
  sourceQuality: number;
  analysisDepth: number;
}

export interface ResolutionResult {
  resolution: boolean;
  workers: string[];
  weights: bigint[];
  dimScores: number[];
}
```

### 5.3 Los 6 Steps — Resumen

| Step | Nombre | Herramienta CRE | Input | Output |
|------|--------|-----------------|-------|--------|
| 1 | READ | EVMClient.callContract | Chain state | WorkerData[] |
| 2 | ASK | HTTPClient (Confidential) | Questions → workers | WorkerDetermination[] |
| 3 | CHALLENGE | HTTPClient + generateChallenges | Contradictions → workers | ChallengeResult[] |
| 4 | EVALUATE | evaluateWorkers (algorítmico) | Evidence + challenges | WorkerEvaluation[] |
| 5 | RESOLVE | computeResolution | Evaluations + determinations | ResolutionResult |
| 6 | WRITE | runtime.report() + writeReport | ResolutionResult | DON-signed tx |

### 5.4 Triggers (main.ts)

El workflow soporta 2 triggers:

1. **EVM Log Trigger**: Escucha eventos `ResolutionRequested(uint256,string)` en CREsolverMarket
2. **HTTP Trigger**: Acepta POST requests con `{ market_id: number }` para trigger manual

Ambos triggers ejecutan la misma función `resolveMarket()` que orquesta los 6 steps.

### 5.5 Step 5: Resolve (la más importante)

```typescript
export function computeResolution(
  determinations: WorkerDetermination[],
  evaluations: WorkerEvaluation[],
  workers: WorkerData[],
): ResolutionResult {
  // Weighted majority vote
  for (const det of determinations) {
    const repFactor = w.reputation.count > 0
      ? (avgRep / 100 + 0.5) : 1.0;
    const voteWeight = ev.qualityScore * repFactor;
    if (det.determination) yesWeight += voteWeight;
    else noWeight += voteWeight;
  }
  const resolution = yesWeight >= noWeight;

  // Blinded weights for on-chain
  for (const det of determinations) {
    const correctnessMult = det.determination === resolution ? 200 : 50;
    const weight = Math.round(ev.qualityScore * correctnessMult * repFactor);
    resultWorkers.push(det.workerAddress);
    resultWeights.push(BigInt(weight));
    resultDimScores.push(ev.resolutionQuality, ev.sourceQuality, ev.analysisDepth);
  }

  return { resolution, workers: resultWorkers, weights: resultWeights, dimScores: resultDimScores };
}
```

### 5.6 Step 6: Write

**Modo CRE (producción)**:
```typescript
// Encode payload
const encodedPayload = encodeAbiParameters(
  [{ type: "uint256" }, { type: "address[]" }, { type: "uint256[]" }, { type: "uint8[]" }, { type: "bool" }],
  [BigInt(marketId), result.workers, result.weights, dimScoresU8, result.resolution],
);

// DON signs → KeystoneForwarder → CREReceiver → resolveMarket
const report = runtime.report(prepareReportRequest(encodedPayload)).result();
evmClient.writeReport(runtime, { receiver: receiverAddr, report, gasConfig: { gasLimit } }).result();
```

**Modo local (E2E)**: El `workflow-runner.ts` simula el DON llamando `resolveMarket()` directamente.

---

## 6. Worker Agent (TypeScript/Hono)

### 6.1 Estructura

```
cresolver/
└── agent/
    ├── package.json
    ├── Dockerfile           # Node 20 alpine + tsx
    ├── src/
    │   ├── index.ts         # Hono server entry
    │   ├── config.ts        # Environment config
    │   ├── validation.ts    # Zod schemas
    │   ├── routes/
    │   │   ├── health.ts    # GET /health
    │   │   └── a2a.ts       # POST /a2a/resolve + /a2a/challenge
    │   └── services/
    │       ├── investigator.ts  # Mock + LLM investigation
    │       └── defender.ts      # Challenge defense
    └── tests/
        └── agent.test.ts
```

### 6.2 Endpoints A2A

```
POST /a2a/resolve
  Request:  { market_id: number, question: string, deadline?: number, context?: string }
  Response: { determination: boolean, confidence: number, evidence: string, sources: string[] }

POST /a2a/challenge
  Request:  { challenges: string[] }
  Response: { responses: string[] }

GET /health
  Response: { status: "ok", agent: string, mode: "llm" | "mock" }
```

### 6.3 Cómo Investiga

```typescript
// investigator.ts
export async function investigate(question: string, marketId?: number): Promise<ResolveResponse> {
  // Check cache (critical for CRE consensus: all DON nodes get identical responses)
  if (marketId !== undefined) {
    const cached = getCached(marketId);
    if (cached) return cached;
  }

  let result: ResolveResponse;
  if (config.isLlmMode) {
    // OpenAI with temperature=0, seed=42 for determinism
    result = await llmInvestigate(question);
  } else {
    result = mockInvestigate(question);
  }

  // Cache the result (10 min TTL)
  if (marketId !== undefined) setCache(marketId, result);
  return result;
}
```

### 6.4 Mock para Testing

Sin API key, el worker usa respuestas deterministas basadas en keywords:
- `"bitcoin" + "200k"` → False, confidence 0.65
- `"ethereum" + "pos"` → True, confidence 0.99
- `"etf"` → True, confidence 0.72
- Default → hash-based deterministic (hash del question)

### 6.5 Response Caching

Ambos servicios (investigator y defender) implementan cache con TTL de 10 minutos.
Esto es **crítico para CRE**: todos los nodos del DON deben obtener respuestas idénticas
al hacer la misma query al mismo agent. Sin cache, requests no-deterministas (LLM)
podrían producir resultados distintos en cada nodo, rompiendo el consenso.

---

## 7. Scripts de Setup y Demo

### 7.1 setup-demo.ts

```
1. Espera a que Anvil esté listo
2. Espera a que los 3 agents estén healthy
3. Deploya CREsolverMarket con Foundry
4. Autoriza deployer como resolver (para demo local sin CRE)
5. Crea 3 mercados de prueba con reward pools
6. Workers joinean cada mercado con stake
7. Genera demo-config.json con addresses y config
```

### 7.2 demo-run.ts

```
1. Lee demo-config.json
2. Verifica health de todos los agents
3. Para el market especificado:
   a. Lee datos del mercado on-chain
   b. Query a cada worker: POST /a2a/resolve
   c. Genera challenges basados en disagreements
   d. Query a cada worker: POST /a2a/challenge
   e. Evalúa quality scores
   f. Computa weighted majority + blinded weights
   g. Llama resolveMarket() on-chain
4. Muestra resultados y reputación actualizada
```

### 7.3 Demo 3 Mercados

```
MERCADO 0: "Will bitcoin reach 200k by end of 2026?"
─────────────────────────────────────────────────────
Mock response: determination=false, confidence=0.65
→ Workers acuerdan: resolución NO

MERCADO 1: "Has ethereum successfully transitioned to pos consensus?"
───────────────────────────────────────────────────────────────────────
Mock response: determination=true, confidence=0.99
→ Workers acuerdan: resolución YES

MERCADO 2: "Will a spot bitcoin etf be approved in 2024?"
──────────────────────────────────────────────────────────
Mock response: determination=true, confidence=0.72
→ Workers acuerdan: resolución YES

→ Reputación acumula (count 1 → 2 → 3)
→ Edge case: re-resolve market throws AlreadyResolved
```

---

## 8. Flujo de Fondos

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ═══════ SETUP ═══════                                                     │
│                                                                             │
│  Creador ──createMarket{1 ETH}──> Market.rewardPool = 1 ETH               │
│  Worker A ─joinMarket{0.01 ETH}─> stakes[marketId][A] = 0.01 ETH          │
│  Worker B ─joinMarket{0.01 ETH}─> stakes[marketId][B] = 0.01 ETH          │
│                                                                             │
│  Contract balance = 1.02 ETH (reward + stakes)                             │
│                                                                             │
│  ═══════ RESOLUTION ═══════                                                │
│                                                                             │
│  CREReceiver (or direct resolver) calls resolveMarket():                   │
│    rewardPool  = 1.00 ETH                                                  │
│    totalWeight = 900000 + 100000 = 1,000,000                               │
│                                                                             │
│    Worker A: reward = 1.0 × 900000/1000000 = 0.90 ETH                     │
│              + stake back = 0.01 ETH                                       │
│              → balances[A] = 0.91 ETH                                      │
│                                                                             │
│    Worker B: reward = 1.0 × 100000/1000000 = 0.10 ETH                     │
│              + stake back = 0.01 ETH                                       │
│              → balances[B] = 0.11 ETH                                      │
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
| Caller no autorizado llama resolveMarket | `authorizedResolvers[msg.sender]` check |
| Worker no registrado incluido en resolución | `stakes[marketId][worker] == 0` reverts con `UnregisteredWorker` |
| Worker se registra 2 veces | `AlreadyJoined` check en joinMarket |
| Más de 10 workers | `TooManyWorkers` check (MAX_WORKERS = 10) |
| Double-resolve | `AlreadyResolved` check en resolveMarket |
| Reentrancy en withdraw | `ReentrancyGuard` de OpenZeppelin |
| Forwarder no autorizado envía report | `ReceiverTemplate` valida `msg.sender == forwarder` |
| Workflow no autorizado | `enforceWorkflowIdentity` + whitelist en ReceiverTemplate |
| Metadata malformada | `MetadataTooShort` check (minimum 64 bytes) |
| Inferencia de votos por ratio de reward | Con ≥3 workers, múltiples combinaciones producen el mismo ratio |

---

## 10. Privacy (Chainlink CRE)

### 10.1 Confidential HTTP (incluido por usar CRE)

| Dato | Dónde vive | Privado |
|------|-----------|---------|
| Determinación de cada worker | TEE de CRE | SI |
| Evidencia y fuentes | TEE de CRE | SI |
| Challenge Q&A | TEE de CRE | SI |
| Scores crudos (quality) | TEE de CRE | SI |
| Multiplicador correctitud | TEE de CRE | SI |
| API keys del LLM | TEE de CRE | SI |

### 10.2 Modelo Completo

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
    │  (pública)       │      │  (on-chain)             │
    │                  │      │                         │
    │  ResQuality=85   │      │  Worker A: 0.91 ETH     │
    │  SrcQuality=72   │      │  Worker B: 0.11 ETH     │
    │  Analysis=65     │      │                         │
    │                  │      │  Calculado de weights[] │
    │  Consultable     │      │  blindados              │
    │  por cualquiera  │      │                         │
    └──────────────────┘      └─────────────────────────┘
```

---

## 11. Qué Construimos (Resumen Ejecutivo)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  CONTRATOS SOLIDITY (cresolver/contracts/)                                 │
│  ═══════════════════════════════════════════                                │
│  ✅ CREsolverMarket.sol — Mercado + staking + escrow + reputación          │
│  ✅ CREReceiver.sol — Puente KeystoneForwarder                             │
│  ✅ ReceiverTemplate.sol — Base contract CRE pattern                       │
│  ✅ IReceiver.sol — Interface ERC165                                       │
│  ✅ Tests: CREsolverMarket.t.sol, CREReceiver.t.sol                        │
│  ✅ Deploy: Deploy.s.sol                                                   │
│                                                                             │
│  CRE WORKFLOW (cresolver/cre-workflow/, TypeScript) ✅                     │
│  ═════════════════════════════════════════════════════                      │
│  ✅ main.ts + types.ts + agents.ts + evm.ts + evaluate.ts                  │
│  ✅ EVM Log Trigger + HTTP Trigger                                         │
│  ✅ Local demo mode (direct call via resolveMarket)                        │
│  ⬜ Compila a WASM para DON                                                │
│                                                                             │
│  WORKER AGENT (cresolver/agent/, TypeScript/Hono) ✅                       │
│  ═══════════════════════════════════════════════════                        │
│  ✅ /a2a/resolve + /a2a/challenge + /health                                │
│  ✅ Mock mode (sin API key) + LLM mode (OpenAI)                            │
│  ✅ Response caching (10 min TTL)                                          │
│  ✅ Tests: agent.test.ts                                                   │
│                                                                             │
│  SCRIPTS (cresolver/scripts/, TypeScript) ✅                               │
│  ═══════════════════════════════════════════                                │
│  ✅ setup-demo.ts — Deploy + fund + create markets + join workers          │
│  ✅ demo-run.ts — Full loop de resolución                                  │
│                                                                             │
│  E2E SANDBOX (cresolver/e2e/ + Docker Compose) ✅                          │
│  ═════════════════════════════════════════════════                          │
│  ✅ docker-compose.e2e.yml — Anvil (8547) + 3 agents (3101-3103)          │
│  ✅ agent/Dockerfile — Node 20 alpine + tsx                                │
│  ✅ e2e/setup.ts + helpers.ts + e2e.test.ts (12 tests)                     │
│  ✅ yarn e2e — one-command: up → setup → test → down                       │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────         │
│  PENDIENTE: Deploy testnet, WASM DON, video demo                           │
│  ─────────────────────────────────────────────────────────────────         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 12. Plan de Implementación

### Fase 1: Contratos — ✅ COMPLETADA

| Paso | Qué | Estado |
|------|-----|--------|
| 1 | `CREsolverMarket.sol` (standalone market contract) | ✅ |
| 2 | `CREReceiver.sol` (puente KeystoneForwarder) | ✅ |
| 3 | `ReceiverTemplate.sol` + `IReceiver.sol` | ✅ |
| 4 | Tests: `CREsolverMarket.t.sol`, `CREReceiver.t.sol` | ✅ |
| 5 | Deploy script: `Deploy.s.sol` | ✅ |

### Fase 2: Worker Agent + CRE Workflow — ✅ COMPLETADA

| Paso | Qué | Estado |
|------|-----|--------|
| 6 | Estructura `cresolver/` (agent, cre-workflow, scripts, shared, contracts) | ✅ |
| 7 | Worker Agent: TypeScript/Hono (health, /a2a/resolve, /a2a/challenge) | ✅ |
| 8 | Worker Agent: mock + LLM modes + caching | ✅ |
| 9 | Worker Agent: tests | ✅ |
| 10 | CRE Workflow: types, agents, evm, evaluate, main | ✅ |
| 11 | Scripts: setup-demo.ts, demo-run.ts | ✅ |

### Fase 3: Integración E2E — ✅ COMPLETADA

| Paso | Qué | Estado |
|------|-----|--------|
| 12 | Docker Compose: Anvil (8547) + 3 agents (3101-3103) | ✅ |
| 13 | E2E setup: deploy, fund, create markets, join | ✅ |
| 14 | E2E tests: 12 tests (3 markets + edge cases) | ✅ |
| 15 | One-command: `yarn e2e` (up → setup → test → down) | ✅ |

### Fase 4: Polish + Submission — PENDIENTE

| Paso | Qué | Estado |
|------|-----|--------|
| 16 | Deploy en testnet (si CRE DON disponible) | ⬜ |
| 17 | Documentar: README, arquitectura | ✅ |
| 18 | Video demo | ⬜ |
| 19 | Submit hackathon | ⬜ |

---

## 13. Puertos y Config

### Puertos (E2E Docker)

| Servicio | Puerto Host | Puerto Container |
|----------|-------------|-----------------|
| Anvil | 8547 | 8545 |
| Agent Alpha | 3101 | 3000 |
| Agent Beta | 3102 | 3000 |
| Agent Gamma | 3103 | 3000 |

### Puertos (Demo local)

| Servicio | Puerto |
|----------|--------|
| Anvil | 8545 |
| Agent Alpha | 3001 |
| Agent Beta | 3002 |
| Agent Gamma | 3003 |

### Environment Variables

| Variable | Default | Uso |
|----------|---------|-----|
| `AGENT_PORT` | 3001 | Puerto del agent |
| `AGENT_NAME` | "Worker" | Nombre del agent |
| `LLM_API_KEY` | "" | OpenAI key (vacío = mock mode) |
| `LLM_MODEL` | "gpt-4o-mini" | Modelo LLM |
| `RPC_URL` | http://127.0.0.1:8545 | Endpoint Ethereum |
| `KEYSTONE_FORWARDER` | address(0) | Address del forwarder (deploy script) |
| `DIRECT_RESOLVER` | address(0) | Resolver directo para demo (deploy script) |

### Package Manager

**YARN** (no npm, no pnpm).

---

## 14. Checklist de Validación

### Contratos

- [x] `forge build` → compila sin errores
- [x] CREsolverMarket tests pasan (16 tests)
- [x] CREReceiver tests pasan (9 tests)

### Worker Agent

- [x] `yarn test` en agent/ → tests pasan
- [x] `GET /health` → `{"status": "ok", "agent": "...", "mode": "mock"}`
- [x] `POST /a2a/resolve` → determination + evidence (mock mode)
- [x] `POST /a2a/challenge` → responses

### CRE Workflow

- [x] `yarn typecheck` → no errors
- [x] Config schema validado con Zod

### E2E Sandbox (Docker)

- [x] `docker compose -f docker-compose.e2e.yml config` → valida
- [x] `yarn e2e` → up → setup → test → down
- [x] Anvil en puerto 8547, agents en 3101-3103
- [x] Setup: deploy + fund + create 3 markets + join workers

### Demo 3 Mercados

- [x] Market 0 "bitcoin 200k" → resolución NO (mock)
- [x] Market 1 "ethereum PoS" → resolución YES (mock)
- [x] Market 2 "bitcoin ETF" → resolución YES (mock)
- [x] Reputación acumula (count 1 → 2 → 3)
- [x] Edge case: re-resolve market throws AlreadyResolved
