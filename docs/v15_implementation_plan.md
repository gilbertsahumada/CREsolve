# ChaosSettler v15 — Plan de Implementación Detallado

> Blueprint completo para construir ChaosSettler v14 paso a paso.
> Incluye diagramas de secuencia, flujo, estructura del proyecto, y checklist de validación.
>
> **Pre-requisito**: Leer v14_chaoschain_integration.md para decisiones arquitectónicas.

---

## 1. DIAGRAMA DE SECUENCIA COMPLETO

```
FASE 1: SETUP (on-chain)
═════════════════════════

Creator            ChaosCore              StudioProxy         IdentityReg
  │                    │                      │                    │
  │──createStudio─────>│                      │                    │
  │  ("ChaosSettler",  │──deploy──────────────>│                    │
  │   resLogicAddr)    │  (chaosCore, registry,│                    │
  │                    │   logicModule,        │                    │
  │                    │   rewardsDist)        │                    │
  │<──(proxy, id)──────│                      │                    │
  │                    │                      │                    │

Admin            RewardsDistributor
  │                    │
  │──setAuthorized────>│  authorizedResolvers[CRE_DON] = true
  │  Resolver(CRE,true)│
  │<──ok───────────────│

Creator            StudioProxy
  │                    │
  │──deposit──────────>│  _totalEscrow += 1 ETH
  │  {value: 1 ETH}   │
  │<──ok───────────────│

Worker A         IdentityReg            StudioProxy
  │                    │                      │
  │──register─────────>│                      │
  │ ("https://...json")│                      │    agent-a.json:
  │<──(agentId=1)──────│                      │    { "endpoints": [{
  │                    │                      │        "name": "a2a",
  │──registerAgent────>│──ownerOf(1)─────────>│        "endpoint":
  │  {value:0.01 ETH}  │<──workerAddr────────│        "https://agent-a/a2a"
  │  (agentId=1,       │  _agentIds[addr]=1   │    }]}
  │   AgentRole.WORKER)│  _agentStakes[1]=0.01│
  │                    │  _totalEscrow+=0.01   │
  │<──ok───────────────│                      │
  │                    │                      │
(Workers B, C repiten)


FASE 2: CRE RESOLUTION (off-chain DON + Confidential HTTP)
═══════════════════════════════════════════════════════════

CRE DON          StudioProxy      IdentityReg     ReputationReg
  │                    │               │                │
  │ STEP 1: READ       │               │                │
  │──getAgentId(A)────>│               │                │
  │<──agentId=1────────│               │                │
  │──getAgentStake(1)─>│               │                │
  │<──0.01 ETH─────────│               │                │
  │──getTotalEscrow()─>│               │                │
  │<──1.03 ETH─────────│               │                │
  │──tokenURI(1)───────│──────────────>│                │
  │<──"https://...json"│───────────────│                │
  │──HTTP.get(URI)─────│ (parse JSON → a2a endpoint)    │
  │──getSummary(1,─────│───────────────│───────────────>│
  │  [rewardsDist],    │               │                │
  │  "RESOLUTION_      │               │                │
  │   QUALITY","")     │               │                │
  │<──(count,value)────│───────────────│────────────────│

CRE DON          Worker A (oráculo)  Worker B (oráculo)
  │                    │                    │
  │ STEP 2: ASK        │                    │
  │──POST /a2a/resolve>│                    │
  │  {question,        │──investigar        │
  │   market_id}       │  (LLM+web)        │
  │<──{determination:  │                    │
  │    true,           │                    │
  │    evidence:"...", │                    │
  │    sources:[...]}──│                    │
  │                    │                    │
  │──POST /a2a/resolve>│──────────────────>│
  │                    │                    │──investigar
  │<──{determination:false,evidence,sources}│

CRE DON          LLM API         Worker A         Worker B
  │                 │                │                │
  │ STEP 3: CHALLENGE               │                │
  │──generate──────>│                │                │
  │  challenges     │                │                │
  │<──questions[]───│                │                │
  │──POST /a2a/challenge────────────>│                │
  │<──{responses:[...]}──────────────│                │
  │──POST /a2a/challenge────────────────────────────>│
  │<──{responses:[...]}──────────────────────────────│

CRE DON          LLM API
  │                 │
  │ STEP 4: EVALUATE│
  │──evaluate──────>│  (all evidence + challenge Q&A)
  │<──{scores:[     │
  │    A:quality=90, │
  │    B:quality=40]}│

CRE DON (STEP 5: RESOLVE — cómputo puro, sin calls externos)
  │
  │ Weighted majority vote: yesWeight > noWeight → TRUE
  │ Pre-compute blinded weights (Option 4):
  │   weight_A = quality_A × 200 (accurate) × rep_A = 900000
  │   weight_B = quality_B × 50 (inaccurate) × rep_B = 100000
  │ dimScores = [A_resQ=90, A_srcQ=85, A_analysis=80,
  │              B_resQ=40, B_srcQ=35, B_analysis=30]
  │ determinations = [true, false]  ← STAYS OFF-CHAIN (confidential)

CRE DON          KeystoneForwarder    CREReceiver          RewardsDistributor     StudioProxy      ReputationReg
  │                    │                    │                      │                      │                │
  │ STEP 6: WRITE      │                    │                      │                      │                │
  │──runtime.report()─>│                    │                      │                      │                │
  │  (encoded payload) │──report()─────────>│                      │                      │                │
  │                    │  (DON-signed)      │──onReport(meta,rpt)─>│                      │                │
  │                    │                    │  decode → forward     │                      │                │
  │                    │                    │──resolveAnd──────────>│                      │                │
  │                    │                    │  Distribute(          │──getAgentId(A)──────>│                │
  │                    │                    │   studio, epoch,      │<──1──────────────────│                │
  │                    │                    │   [A,B],              │──getAgentStake(1)───>│                │
  │                    │                    │   [900000,100000],    │<──0.01───────────────│                │
  │                    │                    │   [90,85,80,40,35,30],│──getTotalEscrow()───>│                │
  │                    │                    │   true)               │<──1.03───────────────│                │
  │                    │                    │                       │                      │                │
  │                    │                    │                       │ rewardPool = 1.01    │                │
  │                    │                    │                       │ reward_A = 0.91 ETH  │                │
  │                    │                    │                       │ reward_B = 0.10 ETH  │                │
  │                    │                    │                       │                      │                │
  │                    │                    │                       │──releaseFunds(A,0.91)│                │
  │                    │                    │                       │──releaseFunds(A,0.01)│ (stake return) │
  │                    │                    │                       │──releaseFunds(B,0.10)│                │
  │                    │                    │                       │──releaseFunds(B,0.01)│ (stake return) │
  │                    │                    │                       │                      │                │
  │                    │                    │                       │──giveFeedback(1,90,──│───────────────>│
  │                    │                    │                       │  "RESOLUTION_QUALITY",│ (no accuracy) │
  │                    │                    │                       │  "","","",0x0)        │                │
  │                    │                    │                       │──giveFeedback(1,85,──│───────────────>│
  │                    │                    │                       │  "SOURCE_QUALITY",...)│                │
  │                    │                    │                       │──giveFeedback(1,80,──│───────────────>│
  │                    │                    │                       │  "ANALYSIS_DEPTH",...) │               │
  │                    │                    │                       │──giveFeedback(2,40,──│───────────────>│
  │                    │                    │                       │  "RESOLUTION_QUALITY")│ (3 dims × B)  │
  │                    │                    │                       │──giveFeedback(2,35,..)│───────────────>│
  │                    │                    │                       │──giveFeedback(2,30,..)│───────────────>│
  │                    │                    │                       │                      │                │
  │                    │                    │                       │ _epochWork[studio][epoch].push(hash)  │
  │                    │                    │<──ok─────────────────│                      │                │
  │<──tx receipt───────│────────────────────│                      │                      │                │


FASE 3: WITHDRAW (on-chain)
═══════════════════════════

Worker A         StudioProxy
  │──withdraw()──────>│  _withdrawable[A] = 0.95 → transfer
  │<──0.95 ETH────────│

Worker B         StudioProxy
  │──withdraw()──────>│  _withdrawable[B] = 0.07 → transfer
  │<──0.07 ETH────────│
```

---

## 2. DIAGRAMA DE FLUJO DEL CRE WORKFLOW

```
┌────────────────────┐
│   CRE TRIGGER      │  Cron/EVM Log: resolutionDeadline reached
│   Input: studio,   │
│   epoch, question   │
└─────────┬──────────┘
          │
┌─────────▼──────────┐
│  STEP 1: READ      │  EVMClient.read
├────────────────────┤
│ StudioProxy:       │
│  • AgentRegistered │  → filter role=WORKER
│    events          │  → addresses, agentIds
│  • getAgentStake() │  → stakes
│  • getTotalEscrow()│  → total funds
│ IdentityRegistry:  │
│  • tokenURI()      │  → metadata URI
│  • HTTP.get(URI)   │  → parse → a2a endpoint
│ ReputationRegistry:│
│  • getSummary()    │  → reputation per worker
└─────────┬──────────┘
          │
┌─────────▼──────────┐
│  Validación:       │
│  workers > 0?      │──NO──→ ABORT("No workers")
│  workers <= 10?    │──NO──→ ABORT("Too many")
│  escrow > stakes?  │──NO──→ ABORT("No reward")
└─────────┬──────────┘
          │ OK
┌─────────▼──────────┐
│  STEP 2: ASK       │  Confidential HTTP
├────────────────────┤
│ Per worker:        │
│  POST {url}/a2a/   │
│    resolve         │
│  Body: {question,  │
│   market_id}       │
│  Timeout: 30s      │
│  Retry: 1x         │
│                    │
│  Response:         │
│   determination    │
│   evidence         │
│   sources[]        │
└─────────┬──────────┘
          │
┌─────────▼──────────┐
│  Worker timeout?   │──YES──→ quality[i] = 0, continuar
│  All failed?       │──YES──→ ABORT("All workers failed")
└─────────┬──────────┘
          │
┌─────────▼──────────┐
│  STEP 3: CHALLENGE │  Confidential HTTP → LLM + Workers
├────────────────────┤
│ LLM: genera        │
│  challenges basado │
│  en contradicciones│
│  entre evidencias  │
│                    │
│ Per worker:        │
│  POST {url}/a2a/   │
│    challenge       │
│  Body: {challenges}│
│  Response:         │
│   responses[]      │
└─────────┬──────────┘
          │
┌─────────▼──────────┐
│  STEP 4: EVALUATE  │  Confidential HTTP → LLM
├────────────────────┤
│ LLM evalúa por     │
│ worker:            │
│  • source quality  │
│  • reasoning depth │
│  • evidence align  │
│  • challenge       │
│    defense         │
│                    │
│ Output per worker: │
│  resolutionQuality │  0-100
│  sourceQuality     │  0-100
│  analysisDepth     │  0-100
│  qualityScore      │  0-100 (aggregate)
└─────────┬──────────┘
          │
┌─────────▼──────────┐
│  STEP 5: RESOLVE   │  Cómputo puro (sin I/O)
├────────────────────┤
│ 1. Weighted vote:  │
│  yes = Σ(q×rep)    │  donde determ=true
│  no  = Σ(q×rep)    │  donde determ=false
│  resolution =      │
│    yes > no        │
│                    │
│ 2. Blinded weights │  (Option 4)
│  w[i] = q[i]      │
│   × corrMult      │  (200 accurate, 50 inaccurate)
│   × rep[i]        │
│                    │
│ 3. dimScores:      │
│  [resQ, srcQ,      │  3 scores per worker
│   analysis] × N    │  (flat array)
│                    │
│ determinations[]   │  → STAYS OFF-CHAIN
└─────────┬──────────┘
          │
┌─────────▼──────────┐
│  STEP 6: WRITE     │  runtime.report()
├────────────────────┤
│ KeystoneForwarder  │
│ → CREReceiver      │
│   .onReport()      │
│ → resolveAndDistri-│
│   bute(            │
│   studio, epoch,   │
│   workers[],       │
│   weights[],       │  (blinded)
│   dimScores[],     │  (3 per worker)
│   resolution)      │
└─────────┬──────────┘
          │
┌─────────▼──────────┐
│  tx revert?        │──YES──→ RETRY (max 3, gas +20%)
│  all retries fail? │──YES──→ ABORT + emit event
└─────────┬──────────┘
          │
┌─────────▼──────────┐
│       DONE         │
│ Emit WorkflowDone  │
└────────────────────┘
```

---

## 3. DIAGRAMA DE FLUJO DEL WORKER AGENT

```
┌──────────────────────────────┐
│    WORKER AGENT LIFECYCLE    │
└──────────────┬───────────────┘
               │
┌──────────────▼───────────────┐
│  FASE A: REGISTRO (1 vez)    │
├──────────────────────────────┤
│ A1. Generar keypair ETH      │
│ A2. Crear metadata JSON:     │
│   { "name": "Oracle A",     │
│     "endpoints": [{          │
│       "name": "a2a",         │
│       "endpoint": "https://  │
│         agent-a/a2a"         │
│     }] }                     │
│   → Upload a IPFS/HTTPS     │
│ A3. IdentityRegistry         │
│   .register(agentURI)        │
│   → agentId                  │
│ A4. StudioProxy              │
│   .registerAgent             │
│   {value: 0.01 ETH}(        │
│     agentId, WORKER)         │
│ A5. Iniciar servidor FastAPI │
└──────────────┬───────────────┘
               │
┌──────────────▼───────────────┐
│  FASE B: SERVIR REQUESTS     │
│  (loop continuo)             │
└──────┬───────┬───────────────┘
       │       │
┌──────▼──┐ ┌──▼──────────────┐
│/a2a/    │ │/a2a/challenge   │
│resolve  │ ├─────────────────┤
├─────────┤ │ Input:          │
│ Input:  │ │  challenges[]   │
│  question│ │                 │
│  market │ │ Per challenge:  │
│  deadline│ │  1. Analizar    │
│         │ │  2. Buscar más  │
│ Proceso:│ │     evidencia   │
│ 1.Search│ │  3. Construir   │
│   web   │ │     defensa     │
│ 2.News  │ │                 │
│   APIs  │ │ Output:         │
│ 3.LLM   │ │  responses[]    │
│  analyze│ └─────────────────┘
│ 4.Deter-│
│  mine   │
│         │
│ Output: │
│ determi-│
│ nation  │
│ evidence│
│ sources │
└─────────┘

┌──────────────────────────────┐
│  FASE C: WITHDRAW            │
├──────────────────────────────┤
│ StudioProxy                  │
│   .getWithdrawableBalance()  │
│   → si > 0:                  │
│ StudioProxy.withdraw()       │
│   → recibir reward + stake   │
└──────────────────────────────┘
```

---

## 4. ESTRUCTURA DETALLADA DEL PROYECTO

```
chaossettler/                              # NUEVO REPO
├── README.md                              # Descripción, setup, demo
├── package.json                           # Monorepo root (yarn workspaces)
├── .env.example                           # Variables de entorno
│
├── contracts/                             # Smart contracts (Foundry)
│   ├── foundry.toml                       # sol 0.8.24, cancun, via_ir
│   ├── remappings.txt                     # @chaoschain/=../../packages/contracts/src/
│   │
│   ├── src/
│   │   └── ResolutionMarketLogic.sol      # LogicModule (~80 líneas)
│   │       # createMarket(question, deadline, rewardPool)
│   │       # getMarket(marketId), isMarketActive(marketId)
│   │       # getScoringCriteria() → 5 PoA + 3 custom dims
│   │       # Patrón: PredictionMarketLogic.sol líneas 74-204
│   │
│   ├── test/
│   │   ├── ResolveAndDistribute.t.sol     # Tests resolveAndDistribute (~200 lín)
│   │   │   # test_happy_path_two_workers
│   │   │   # test_all_agree / test_split_decision
│   │   │   # test_reputation_affects_weight
│   │   │   # test_reverts_unauthorized / test_reverts_no_workers
│   │   │   # test_returns_stakes / test_publishes_reputation
│   │   │   # Patrón: CloseEpoch.integration.t.sol líneas 103-496
│   │   │
│   │   └── ResolutionMarketLogic.t.sol    # Tests LogicModule (~100 líneas)
│   │
│   └── script/
│       └── DeployChaosSettler.s.sol        # Deploy script Anvil+testnet (~100 lín)
│           # 1. Deploy ResolutionMarketLogic
│           # 2. Register en ChaosCore
│           # 3. createStudio → StudioProxy
│           # 4. setAuthorizedResolver(CRE_DON, true)
│           # 5. deposit reward pool
│           # Patrón: DeployCore.s.sol líneas 26-141
│
├── cre-workflow/                           # CRE Resolution Workflow
│   ├── package.json                       # typescript, @chainlink/cre-sdk
│   ├── tsconfig.json
│   │
│   └── src/
│       ├── index.ts                       # Entry point (~50 lín)
│       ├── types.ts                       # WorkerInfo, ResolutionRequest, etc (~60 lín)
│       ├── step1-read.ts                  # READ: workers + endpoints + rep (~80 lín)
│       │   # readRegisteredWorkers(studioAddr) → EVMClient.read
│       │   # readWorkerEndpoints(workers, identityAddr) → tokenURI + HTTP.get
│       │   # readWorkerReputations(workers, repAddr) → getSummary
│       ├── step2-ask.ts                   # ASK: POST /a2a/resolve (~60 lín)
│       ├── step3-challenge.ts             # CHALLENGE: LLM + /a2a/challenge (~80 lín)
│       ├── step4-evaluate.ts              # EVALUATE: LLM quality scores (~60 lín)
│       ├── step5-resolve.ts               # RESOLVE: weighted majority (~50 lín)
│       └── step6-write.ts                 # WRITE: resolveAndDistribute (~40 lín)
│
├── agent/                                 # Worker Agent — oráculo de IA
│   ├── requirements.txt                   # fastapi, uvicorn, openai, httpx, web3
│   ├── Dockerfile
│   │
│   ├── src/
│   │   ├── main.py                        # FastAPI app + /health (~40 lín)
│   │   ├── config.py                      # LLM_API_KEY, RPC_URL, etc (~30 lín)
│   │   ├── routes/
│   │   │   └── a2a.py                     # POST /a2a/resolve, /a2a/challenge (~80 lín)
│   │   │       # ResolveRequest → ResolveResponse (determination, evidence, sources)
│   │   │       # ChallengeRequest → ChallengeResponse (responses[])
│   │   └── services/
│   │       ├── investigator.py            # Investigación: web search + LLM (~100 lín)
│   │       └── defender.py                # Defensa ante challenges (~60 lín)
│   │
│   └── tests/
│       ├── test_resolve.py                # Tests /a2a/resolve (~60 lín)
│       └── test_challenge.py              # Tests /a2a/challenge (~40 lín)
│
└── scripts/                               # Setup y demo (TypeScript)
    ├── register-worker.ts                 # Mint NFT + registerAgent (~80 lín)
    │   # Patrón: e2e/setup.ts líneas 192-224
    ├── create-market.ts                   # createStudio + deposit (~60 lín)
    ├── setup-demo.ts                      # Deploy + 3 markets + 3 workers (~120 lín)
    └── demo-run.ts                        # Ejecutar flujo completo + mostrar rep (~80 lín)
```

---

## 5. PLAN DE IMPLEMENTACIÓN PASO A PASO

### Componente A: Modificar RewardsDistributor (+65 líneas)

**Archivo**: `packages/contracts/src/RewardsDistributor.sol`

**A1. Agregar estado** (después de línea ~61):
```solidity
mapping(address => bool) public authorizedResolvers;
event ResolverUpdated(address indexed resolver, bool authorized);
event ResolutionCompleted(address indexed studio, uint64 indexed epoch,
    bool resolution, uint256 totalDistributed, uint256 workerCount);
```

**A2. Agregar modifier** (después de constructor):
```solidity
modifier onlyOwnerOrResolver() {
    require(msg.sender == owner() || authorizedResolvers[msg.sender],
        "Not authorized resolver");
    _;
}
```

**A3. `setAuthorizedResolver()`**:
```solidity
function setAuthorizedResolver(address resolver, bool authorized) external onlyOwner {
    require(resolver != address(0), "Invalid resolver");
    authorizedResolvers[resolver] = authorized;
    emit ResolverUpdated(resolver, authorized);
}
```

**A4. `resolveAndDistribute()`** — función principal (Option 4: Blinded):
```solidity
function resolveAndDistribute(
    address studio, uint64 epoch,
    address[] calldata workers,
    uint256[] calldata weights,       // pre-computed by CRE: quality × correctnessMult × rep
    uint8[] calldata dimScores,       // flat: [w0_resQ, w0_srcQ, w0_analysis, w1_resQ, ...]
    bool resolution
) external onlyOwnerOrResolver {
    // 1. Validaciones (studio != 0, workers 1-10, weights.length == workers.length, dimScores.length == workers * 3)
    // 2. Calcular rewardPool = totalEscrow - totalStakes
    // 3. Distribuir rewards proporcional a weights[] (pre-computados, blindados)
    // 4. releaseFunds() per worker (reward + stake return)
    // 5. _publishResolutionReputation(agentId, dimScores[i*3], dimScores[i*3+1], dimScores[i*3+2])
    //    → 3 giveFeedback() per worker SIN tag ACCURATE/INACCURATE
    // 6. _epochWork[studio][epoch].push(hash)
    // 7. emit ResolutionCompleted(...)
}
```
> **Nota**: `determinations[]` NO aparece en la firma. Los votos individuales quedan en CRE TEE.
> CRE pre-computa `weights[i] = quality × (accurate ? 200 : 50) × reputation` off-chain.

**A5. `_getReputation()`** — helper interno (utilidad, ya no llamado por A4):
```solidity
function _getReputation(uint256 agentId) internal view returns (uint256) {
    // getSummary(agentId, [address(this)], "RESOLUTION_QUALITY", "")
    // count==0 → return 50 (neutral)
    // value < 0 → 10, value > 100 → 100
    // Fallback on revert: 50
}
```
> **Nota**: En Option 4, CRE lee la reputación off-chain y la incorpora en weights[].
> _getReputation() se mantiene como utilidad para consultas externas.

**A6. `_publishResolutionReputation()`** — 3 dimensiones, sin accuracy tag:
```solidity
function _publishResolutionReputation(
    uint256 agentId,
    uint8 resolutionQuality,    // 0-100
    uint8 sourceQuality,        // 0-100
    uint8 analysisDepth         // 0-100
) internal {
    // 3 giveFeedback() calls:
    //   ("RESOLUTION_QUALITY", "")  ← NO accuracy tag
    //   ("SOURCE_QUALITY", "")
    //   ("ANALYSIS_DEPTH", "")
}
```

**Funciones existentes referenciadas**:
- `StudioProxy.getAgentId(address)` — línea ~993
- `StudioProxy.getAgentStake(uint256)` — línea ~1011
- `StudioProxy.getTotalEscrow()` — línea ~597
- `StudioProxy.releaseFunds(address,uint256,bytes32)` — línea ~548
- `IERC8004Reputation.giveFeedback(...)` — interfaz línea 89-98
- `IERC8004Reputation.getSummary(...)` — interfaz línea 143-148

**Patrón a seguir**: `_publishWorkerReputation()` líneas 269-327 (try/catch + extcodesize check).

**Validación**: `forge test` (tests existentes no se rompen) + tests nuevos.

---

### Componente B: ResolutionMarketLogic (LogicModule nuevo)

**Archivo nuevo**: `chaossettler/contracts/src/ResolutionMarketLogic.sol`
**Patrón**: `PredictionMarketLogic.sol` líneas 1-205

- Hereda de `LogicModule` (base en `packages/contracts/src/base/LogicModule.sol`)
- `createMarket(question, rewardPool, duration)` → bytes32 marketId
- `getScoringCriteria()` → 5 PoA universales + 3 custom:
  - Resolution Quality: peso 250
  - Source Quality: peso 200
  - Reasoning Depth: peso 150
- ~80 líneas

**Validación**: `forge test --match-contract ResolutionMarketLogicTest`

---

### Componente C: Tests de resolveAndDistribute

**Archivo nuevo**: `chaossettler/contracts/test/ResolveAndDistribute.t.sol`
**Patrón**: `CloseEpoch.integration.t.sol` líneas 103-496

Setup del test:
1. Deploy MockIdentityRegistry + MockReputationRegistry (reusar patrón de líneas 349-496)
2. Deploy ChaosChainRegistry → RewardsDistributor → Factory → ChaosCore
3. Wire + register ResolutionMarketLogic
4. createStudio → StudioProxy
5. Register 2-3 workers (mint NFT + registerAgent)
6. deposit reward pool

Tests críticos:
```
test_resolveAndDistribute_happy_path          — 2 workers, distribución proporcional
test_resolveAndDistribute_all_accurate        — todos aciertan, resolution=true
test_resolveAndDistribute_split_decision      — 2 true vs 1 false
test_resolveAndDistribute_reputation_weight   — rep alta = más reward
test_resolveAndDistribute_reverts_unauthorized — sin resolver autorizado
test_resolveAndDistribute_reverts_no_workers  — array vacío
test_resolveAndDistribute_reverts_too_many    — >10 workers
test_resolveAndDistribute_returns_stakes      — stakes devueltos a todos
test_resolveAndDistribute_publishes_reputation — giveFeedback llamado correctamente
test_resolveAndDistribute_epoch_tracked       — _epochWork actualizado
test_setAuthorizedResolver_only_owner         — solo owner puede autorizar
```

---

### Componente D: CRE Resolution Workflow

**Directorio**: `chaossettler/cre-workflow/src/`

| Archivo | Función | APIs CRE Usadas |
|---------|---------|-----------------|
| `types.ts` | WorkerInfo, ResolutionRequest, WorkerDetermination, etc | — |
| `step1-read.ts` | Leer workers, endpoints, reputaciones | EVMClient.read, HTTPClient.get |
| `step2-ask.ts` | POST /a2a/resolve per worker | Confidential HTTP (sendRequest) |
| `step3-challenge.ts` | LLM genera + envía challenges | Confidential HTTP → LLM + workers |
| `step4-evaluate.ts` | LLM evalúa quality 0-100 | Confidential HTTP → LLM |
| `step5-resolve.ts` | Weighted majority + final weights | Pure computation (sin I/O) |
| `step6-write.ts` | resolveAndDistribute() | EVMClient.write |
| `index.ts` | Orquesta los 6 steps | Entry point |

ABIs necesarios:
- `StudioProxy`: getAgentId, getAgentStake, getTotalEscrow, AgentRegistered event
- `IdentityRegistry`: tokenURI
- `ReputationRegistry`: getSummary
- `RewardsDistributor`: resolveAndDistribute (nuevo)

---

### Componente E: Worker Agent (Oráculo de IA)

**Directorio**: `chaossettler/agent/`

**Endpoints A2A**:
```
POST /a2a/resolve
  Request:  { market_id, question, deadline, context }
  Response: { determination: bool, confidence: float,
              evidence: string, sources: string[] }

POST /a2a/challenge
  Request:  { challenges: string[] }
  Response: { responses: string[] }

GET /health
  Response: { status: "ok", type: "oracle_agent" }
```

**Flujo de investigación** (`investigator.py`):
1. Recibir pregunta
2. Web search (3 queries diferentes vía SerpAPI o similar)
3. Extraer información relevante de fuentes
4. LLM analiza evidencia y determina resultado
5. Return determination + evidence + sources

**Flujo de defensa** (`defender.py`):
1. Recibir challenges del CRE
2. Per challenge: buscar evidencia adicional si necesario
3. Construir defensa argumentada con el LLM
4. Return responses[]

**Validación**: curl + pytest

---

### Componente F: Scripts de Setup y Demo

- `register-worker.ts`: Mint agent NFT + registerAgent (patrón: `e2e/setup.ts:192-224`)
- `create-market.ts`: createStudio + deposit reward pool
- `setup-demo.ts`: Deploy completo + 3 markets + 3 workers + seed reputation
- `demo-run.ts`: Simular flujo CRE completo + mostrar resultados + reputación acumulada

---

## 6. DEPENDENCIAS Y ORDEN DE EJECUCIÓN

```
         ┌────────────────────────┐
         │ A: Modificar           │
         │ RewardsDistributor     │
         │ (+65 líneas)           │
         └────────┬───────────────┘
                  │
    ┌─────────────┼─────────────┐
    │             │             │
┌───▼─────────┐  │  ┌──────────▼──────────┐
│ B: Resolu-  │  │  │ E: Worker Agent     │
│ tionMarket  │  │  │ (Python/FastAPI)    │
│ Logic       │  │  │ PARALELO con B      │
│ PARALELO    │  │  └──────────┬──────────┘
│ con E       │  │             │
└───┬─────────┘  │             │
    │            │             │
┌───▼─────────┐  │             │
│ C: Tests    │  │             │
│ Solidity    │  │             │
└───┬─────────┘  │             │
    │            │             │
    └─────┬──────┘             │
          │                    │
    ┌─────▼────────────────────▼┐
    │ D: CRE Workflow           │
    │ Necesita A (ABI) + E      │
    │ (endpoints para test)     │
    └──────────┬────────────────┘
               │
    ┌──────────▼────────────────┐
    │ F: Scripts Setup/Demo     │
    │ Necesita A, B, D, E       │
    └──────────┬────────────────┘
               │
    ┌──────────▼────────────────┐
    │ G: Integración E2E + Demo │
    │ Necesita TODO             │
    └───────────────────────────┘
```

**Camino crítico**: A → C → D → F → G
**Paralelizable**: B ∥ E (ambos desde día 1)

**Timeline**:
```
Sem 1 (Feb 14-20):  A + B + E (contratos + worker agent)
Sem 2 (Feb 21-27):  C + D + F (tests + CRE workflow + scripts)
Sem 3 (Feb 28-Mar 1): G (integración + demo + polish)
```

---

## 7. PLAN DE VALIDACIÓN E2E

### Fase 1: Contratos (verificar con forge)
```
□ 1.1 resolveAndDistribute() compila → forge build
□ 1.2 Tests existentes pasan → forge test (236 pass, sin regresión)
□ 1.3 Tests nuevos pasan → forge test --match-contract ResolveAndDistribute
□ 1.4 ResolutionMarketLogic compila y tests pasan
□ 1.5 Deploy en Anvil local (puerto 8546) → forge script sin errores
```

### Fase 2: Worker Agent (verificar con curl)
```
□ 2.1 Servidor inicia → uvicorn agent.src.main:app --port 8000
□ 2.2 Health → curl localhost:8000/health → {"status":"ok"}
□ 2.3 Resolve → curl -X POST localhost:8000/a2a/resolve -d '{...}'
     → {determination, evidence, sources}
□ 2.4 Challenge → curl -X POST localhost:8000/a2a/challenge -d '{...}'
     → {responses}
□ 2.5 Tests → pytest agent/tests/ -v (all pass)
```

### Fase 3: CRE Workflow (verificar con mock workers)
```
□ 3.1 Cada step aislado con mocks (unit tests)
□ 3.2 Workflow completo: 2 workers reales + Anvil + mock CRE trigger
□ 3.3 Verificar: tx exitosa, rewards correctos, reputation publicada
```

### Fase 4: Integración Full
```
□ 4.1 Setup: Anvil(:8546) + deploy + studio + workers + agents running
□ 4.2 Simular flujo CRE: read→ask→challenge→evaluate→resolve→write
□ 4.3 Post-resolución: withdrawable > 0, withdraw() ok, reputation ok
□ 4.4 Tests ChaosChain originales siguen pasando (forge test, 236 pass)
```

### Fase 5: Demo (3 mercados con reputación acumulada)
```
□ 5.1 Market 1: "SEC Solana ETF?" — Worker A (rep=85) vs B,C (rep=50)
     → A gana más por reputación cross-domain (de MusicCollab)
□ 5.2 Market 2: "Ethereum PoS Sep 2022?" — respuesta conocida
     → Todos aciertan, distribución proporcional a quality
□ 5.3 Market 3: "Bitcoin $200k?" — split decision
     → Challenge-response visible, demostrar evaluación de calidad
□ 5.4 Mostrar reputación acumulada después de 3 mercados
     → A subió, worker de baja calidad bajó
```

---

## 8. RIESGOS Y MITIGACIONES

| # | Riesgo | Prob | Impacto | Mitigación |
|---|--------|------|---------|------------|
| 1 | CRE Confidential HTTP no soporta payloads grandes | Media | Alto | Limitar evidence a 2KB; fallback: IPFS CID |
| 2 | LLM scores inconsistentes | Alta | Medio | temperature=0, rúbrica explícita, preguntas conocidas para demo |
| 3 | Worker timeout | Media | Bajo | 30s timeout, quality=0, mín 1 válido |
| 4 | resolveAndDistribute() reverts | Baja | Alto | Tests exhaustivos, gas estimation, retry +20% |
| 5 | Port conflict Docker/Anvil | Alta | Alto | SIEMPRE puerto 8546, verificar block number |
| 6 | Tests ChaosChain se rompen | Muy baja | Alto | Solo funciones NUEVAS, storage layout intacto |
| 7 | Mock ReputationRegistry viejo ABI | Media | Medio | Usar MockReputationRegistryIntegration (Feb 2026) |
| 8 | CRE DON address desconocida | Cierta | Medio | Mock wallet como "CRE"; actualizar post-deploy |
| 9 | Tiempo insuficiente para WASM | Media | Medio | TS puro primero, WASM al final |
| 10 | Fallback a v13 necesario | Baja | Bajo | CRE+agent idénticos; solo cambiar contract (2h) |

---

## 9. ARCHIVOS CRÍTICOS DE REFERENCIA

| Archivo | Propósito | Líneas clave |
|---------|-----------|--------------|
| `packages/contracts/src/RewardsDistributor.sol` | Extender con resolveAndDistribute | L61 (_epochWork), L269-327 (_publishWorkerReputation patrón), L539-550 (registerWork/Validator) |
| `packages/contracts/src/StudioProxy.sol` | Sin cambios, referenciado | L548-562 (releaseFunds), L945-967 (registerAgent), L993 (getAgentId), L1011 (getAgentStake) |
| `packages/contracts/src/interfaces/IERC8004Reputation.sol` | Interfaz Feb 2026 | L89-98 (giveFeedback 8 params), L143-148 (getSummary) |
| `packages/contracts/test/integration/CloseEpoch.integration.t.sol` | Patrón para tests | L103-150 (setup), L349-496 (mock registries) |
| `packages/contracts/script/DeployCore.s.sol` | Patrón para deploy | L26-141 (full deploy order) |
| `packages/contracts/src/logic/PredictionMarketLogic.sol` | Patrón LogicModule | L74-104 (createChallenge), L175-204 (getScoringCriteria) |
| `e2e/setup.ts` | Patrón registro agents | L192-224 (registerAgents) |
