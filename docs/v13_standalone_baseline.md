# ChaosSettler v13 — Baseline sin ChaosChain

> Diseño standalone para el hackathon. Un contrato autocontenido + ERC-8004 independiente.
> Este es el path más rápido y sin dependencias. Sirve como baseline para evaluar
> si la integración con ChaosChain (v14) aporta valor real.
>
> **Framing**: Los workers son **oráculos descentralizados de IA**. No predicen — investigan
> y determinan el resultado real de un evento. CRE evalúa la calidad de su investigación.

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  COMPONENTES                                                                │
│                                                                             │
│  1. ChaosSettlerMarket.sol (NUEVO, ~200 líneas)                             │
│     → Todo en un contrato: mercados, registro, escrow, resolución, rewards  │
│                                                                             │
│  2. ERC-8004 ReputationRegistry (deploy independiente)                      │
│     → giveFeedback() para reputación acumulada entre mercados               │
│     → No depende de ChaosChain — es un estándar abierto                     │
│                                                                             │
│  3. CRE Resolution Workflow (~300 líneas TypeScript)                        │
│     → Lee workers + endpoints del contrato                                  │
│     → Interroga, evalúa, resuelve                                          │
│     → Escribe resultado + reputation on-chain                               │
│                                                                             │
│  4. Worker Agent (Python, FastAPI A2A server) — oráculo de IA               │
│     → Recibe preguntas y challenges de CRE                                  │
│     → Investiga y responde con determinación + evidencia                     │
│                                                                             │
│  NO hay: Gateway, SDK, StudioProxy, RewardsDistributor, Arweave            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## ChaosSettlerMarket.sol — Diseño del Contrato

### Storage

```solidity
struct Market {
    string question;           // "¿Ganará Argentina el Mundial 2030?"
    uint256 deadline;          // Timestamp hasta cuando workers se registran
    uint256 resolutionDeadline; // Timestamp para que CRE resuelva
    address creator;           // Quien creó y financió el mercado
    uint256 rewardPool;        // ETH depositado como reward
    bool resolved;             // Ya resuelto?
    bool resolution;           // true=YES, false=NO
}

struct Worker {
    string a2aEndpoint;        // "https://agent1.example/a2a"
    uint256 stake;             // ETH stakeado
    bool registered;           // Existe?
}

// State
mapping(uint256 => Market) public markets;
mapping(uint256 => mapping(address => Worker)) public workers;
mapping(uint256 => address[]) public workerLists;  // Para iterar
mapping(address => uint256) public withdrawable;    // Pull payment
address public creAddress;                          // CRE DON autorizado
address public reputationRegistry;                  // ERC-8004
uint256 public nextMarketId;
uint8 public constant MAX_WORKERS = 10;
uint256 public constant GRACE_PERIOD = 1 days;
```

### Funciones

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  createMarket(string question, uint256 deadline,                            │
│               uint256 resolutionDeadline) payable → uint256 marketId        │
│  ─────────────────────────────────────────────────────────────              │
│  - msg.value = rewardPool (ETH que se repartirá entre workers)              │
│  - deadline = hasta cuándo se pueden registrar workers                      │
│  - resolutionDeadline = cuándo CRE debe resolver (> deadline)               │
│  - Almacena Market, incrementa nextMarketId                                 │
│  - Emite MarketCreated(marketId, question, rewardPool, deadline)            │
│                                                                             │
│  registerWorker(uint256 marketId, string a2aEndpoint) payable               │
│  ─────────────────────────────────────────────────────────────              │
│  - msg.value = stake (mínimo configurable)                                  │
│  - Requiere: market existe, no resolved, block.timestamp < deadline         │
│  - Requiere: workerLists[marketId].length < MAX_WORKERS                     │
│  - Requiere: !workers[marketId][msg.sender].registered (no duplicados)      │
│  - Almacena Worker con endpoint y stake                                     │
│  - Agrega a workerLists[marketId]                                           │
│  - Emite WorkerRegistered(marketId, msg.sender, a2aEndpoint, stake)         │
│                                                                             │
│  submitConsensus(                                                           │
│      uint256 marketId,                                                      │
│      bool resolution,                                                       │
│      address[] workers,                                                     │
│      uint8[] qualityScores,      // 0-100                                   │
│      bool[] determinations       // qué determinó cada worker (oráculo)     │
│  ) external onlyCRE                                                         │
│  ─────────────────────────────────────────────────────────────              │
│  - Requiere: market existe, no resolved                                     │
│  - Requiere: arrays misma longitud, workers <= MAX_WORKERS                  │
│  - Requiere: cada worker está registrado en este mercado                    │
│  - Para cada worker:                                                        │
│      was_correct = (determinations[i] == resolution)                        │
│      correctness_mult = was_correct ? 200 : 50                              │
│      reputation = getReputation(workers[i])  // ERC-8004, default 50       │
│      weight[i] = qualityScores[i] * correctness_mult * reputation           │
│  - totalWeight = Σ weight[i]                                                │
│  - Para cada worker:                                                        │
│      reward = rewardPool * weight[i] / totalWeight                          │
│      withdrawable[workers[i]] += reward                                     │
│  - markets[marketId].resolved = true                                        │
│  - markets[marketId].resolution = resolution                                │
│  - Devolver stakes a todos los workers (→ withdrawable)                     │
│  - Emite ConsensusSubmitted(marketId, resolution, workers, rewards)          │
│                                                                             │
│  publishReputation(                                                         │
│      uint256 marketId,                                                      │
│      address[] workers,                                                     │
│      uint8[] qualityScores,                                                 │
│      bool[] accurate                                                        │
│  ) external onlyCRE                                                         │
│  ─────────────────────────────────────────────────────────────              │
│  - Para cada worker (oráculo):                                              │
│      IReputationRegistry(reputationRegistry).giveFeedback(                  │
│          agentId,                    // del worker (o address como uint)     │
│          int128(qualityScores[i]),   // 0-100                               │
│          1,                          // valueDecimals                        │
│          "RESOLUTION_QUALITY",       // tag1                                │
│          accurate[i] ? "ACCURATE" : "INACCURATE",  // tag2                 │
│          workers[i].a2aEndpoint,     // endpoint                            │
│          "",                         // feedbackURI (opcional)              │
│          bytes32(0)                  // feedbackHash (opcional)             │
│      )                                                                      │
│  - Nota: podría combinarse con submitConsensus en 1 sola función            │
│    Se separa por claridad y por si el gas de giveFeedback × N es alto       │
│                                                                             │
│  withdraw() external                                                        │
│  ─────────────────────────────────────────────────────────────              │
│  - amount = withdrawable[msg.sender]                                        │
│  - Requiere amount > 0                                                      │
│  - withdrawable[msg.sender] = 0                                             │
│  - Transfer ETH                                                             │
│  - Emite Withdrawal(msg.sender, amount)                                     │
│                                                                             │
│  timeout(uint256 marketId) external                                         │
│  ─────────────────────────────────────────────────────────────              │
│  - Requiere: !resolved                                                      │
│  - Requiere: block.timestamp > resolutionDeadline + GRACE_PERIOD            │
│  - Devolver rewardPool al creator (→ withdrawable)                          │
│  - Devolver stakes a todos los workers (→ withdrawable)                     │
│  - markets[marketId].resolved = true (para bloquear re-entry)               │
│  - Emite MarketTimedOut(marketId)                                           │
│                                                                             │
│  getMarketWorkers(uint256 marketId) view                                    │
│      → (address[] workers, string[] endpoints, uint256[] stakes)            │
│  ─────────────────────────────────────────────────────────────              │
│  - Para que CRE lea todo en 1 call (EVMClient.read)                         │
│  - Returns: lista de workers con sus endpoints y stakes                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Seguridad

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  Amenaza                        │ Defensa                                   │
│  ──────────────────────────────┼───────────────────────────────────────     │
│  CRE comprometido envía        │ submitConsensus valida que cada worker     │
│  addresses falsas               │ esté registrado en el mercado             │
│                                 │                                           │
│  Worker registra y no participa │ Recibe reward bajo (quality=0 del LLM)    │
│                                 │ Su stake se devuelve pero gana ~0 reward  │
│                                 │                                           │
│  CRE no resuelve nunca         │ timeout() después de GRACE_PERIOD          │
│                                 │ Fondos vuelven a creator + workers         │
│                                 │                                           │
│  Reentrancy en withdraw        │ Pull payment pattern + nonReentrant        │
│                                 │                                           │
│  Worker se registra 2 veces    │ require(!workers[id][sender].registered)   │
│                                 │                                           │
│  Más de 10 workers             │ require(workerLists.length < MAX_WORKERS)  │
│                                 │                                           │
│  submitConsensus después de    │ require(!resolved) en submitConsensus      │
│  timeout                        │                                           │
│                                 │                                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## ERC-8004: Deploy Independiente

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ERC-8004 es un estándar abierto. No necesita ChaosChain.                   │
│                                                                             │
│  Lo que deployamos:                                                         │
│  ─────────────────                                                          │
│  1. ERC8004ReputationRegistry.sol                                           │
│     - giveFeedback() → almacena feedback por agente                         │
│     - getFeedback() → lee historial                                         │
│     - Permissionless: cualquiera puede dar feedback                         │
│     - ChaosSettlerMarket lo llama después de cada resolución                │
│                                                                             │
│  2. (Opcional) ERC8004IdentityRegistry.sol                                  │
│     - Mint agent NFT → identidad verificable                                │
│     - Para hackathon: opcional. Podemos usar addresses directamente.        │
│     - Para demo: 3-5 agents con NFT muestra el concepto                     │
│                                                                             │
│  Cómo se acumula la reputación:                                             │
│  ──────────────────────────────                                             │
│  Mercado 1: Worker A quality=90, accurate → feedback positivo               │
│  Mercado 2: Worker A quality=85, accurate → feedback positivo               │
│  Mercado 3: Worker A tiene rep alta → más peso en resolución, más reward    │
│                                                                             │
│  Mercado 1: Worker E quality=20, wrong → feedback negativo                  │
│  Mercado 2: Worker E quality=30, wrong → feedback negativo                  │
│  Mercado 3: Worker E tiene rep baja → menos peso, menos reward              │
│                                                                             │
│  getReputation() en ChaosSettlerMarket:                                     │
│  ──────────────────────────────────────                                     │
│  function getReputation(address worker) internal view returns (uint256) {   │
│      // Lee feedback history de ERC-8004                                    │
│      // Calcula promedio ponderado (o usa último N feedbacks)               │
│      // Si no tiene historial → return 50 (neutral)                         │
│  }                                                                          │
│                                                                             │
│  Nota: cómo se calcula getReputation() a partir del historial de            │
│  giveFeedback es una decisión de diseño. Opciones:                          │
│  a) Promedio simple de todos los quality scores                              │
│  b) Promedio ponderado (recientes pesan más)                                │
│  c) EMA (exponential moving average)                                        │
│  d) Simple: último score (para hackathon)                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Flujo Completo

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ═══════════════════════════════════════════════════                        │
│  FASE 1: SETUP                                                              │
│  ═══════════════════════════════════════════════════                        │
│                                                                             │
│  Creador ──→ ChaosSettlerMarket.createMarket{value: 1 ETH}(                │
│                "¿Aprobará la SEC un ETF de Solana antes de julio 2026?",    │
│                deadline: Feb 25,                                            │
│                resolutionDeadline: Mar 1                                    │
│              )                                                              │
│  → marketId = 1, rewardPool = 1 ETH en escrow                              │
│                                                                             │
│  Worker A ──→ registerWorker{value: 0.01 ETH}(                             │
│                 marketId: 1,                                                │
│                 a2aEndpoint: "https://agent-a.example/a2a"                  │
│               )                                                             │
│                                                                             │
│  Worker B ──→ registerWorker{value: 0.01 ETH}(1, "https://agent-b/a2a")   │
│  Worker C ──→ registerWorker{value: 0.01 ETH}(1, "https://agent-c/a2a")   │
│  ...hasta 10 workers                                                       │
│                                                                             │
│  ═══════════════════════════════════════════════════                        │
│  FASE 2: CRE RESOLUTION (trigger: resolutionDeadline)                       │
│  ═══════════════════════════════════════════════════                        │
│                                                                             │
│  CRE Step 1: READ                                                           │
│  ─────────────────                                                          │
│  EVMClient.read → getMarketWorkers(1)                                       │
│  → workers: [A, B, C, D, E]                                                │
│  → endpoints: ["https://agent-a/a2a", ...]                                  │
│  → stakes: [0.01, 0.01, ...]                                               │
│  EVMClient.read → getReputation(A), getReputation(B), ...                   │
│  → reputations: [50, 50, 50, 50, 50]  (todos nuevos)                       │
│                                                                             │
│  CRE Step 2: ASK (Confidential HTTP)                                        │
│  ─────────────────────────────────────                                      │
│  Para cada worker:                                                          │
│    POST https://agent-X/a2a/resolve                                         │
│    Body: { question: "¿Aprobará la SEC un ETF de Solana...?" }             │
│    Response: {                                                              │
│      determination: true,                                                   │
│      reasoning: "Based on SEC's recent filings and stance...",              │
│      sources: ["reuters.com/...", "sec.gov/..."]                            │
│    }                                                                        │
│  → Privado: solo el DON ve las respuestas                                   │
│                                                                             │
│  CRE Step 3: CHALLENGE (Confidential HTTP → LLM → worker)                  │
│  ─────────────────────────────────────────────────────────                  │
│  Para cada worker:                                                          │
│    LLM genera challenges basados en la respuesta                            │
│    POST https://agent-X/a2a/challenge                                       │
│    Body: { challenges: ["Your source X seems outdated...", ...] }           │
│    Response: { responses: ["Actually, the updated filing from..."] }        │
│  → Privado: challenges nunca se persisten (CRE stateless = la privacidad)   │
│                                                                             │
│  CRE Step 4: EVALUATE (Confidential HTTP → LLM)                            │
│  ────────────────────────────────────────────────                           │
│  LLM evalúa calidad de investigación de cada worker (oráculo):              │
│    Worker A: quality=90 (fuentes sólidas, respuestas detalladas)            │
│    Worker B: quality=80 (buen análisis, menos fuentes)                      │
│    Worker C: quality=85 (excelente razonamiento)                             │
│    Worker D: quality=30 (respuesta superficial)                              │
│    Worker E: quality=20 (casi no investigó)                                 │
│                                                                             │
│  CRE Step 5: RESOLVE (cómputo puro en DON)                                  │
│  ────────────────────────────────────────────                               │
│  Determinations: A=YES, B=YES, C=NO, D=YES, E=NO                           │
│  Weights: quality × reputation × stake                                      │
│    A: 90×50×1 = 4500                                                        │
│    B: 80×50×1 = 4000                                                        │
│    C: 85×50×1 = 4250                                                        │
│    D: 30×50×1 = 1500                                                        │
│    E: 20×50×1 = 1000                                                        │
│  YES weight: 4500+4000+1500 = 10000                                        │
│  NO weight: 4250+1000 = 5250                                               │
│  Resolution: YES (10000 > 5250)                                             │
│                                                                             │
│  Reward weights (with accuracy multiplier):                                 │
│    A: 90×200×50 = 900000  (accurate + high quality research)                │
│    B: 80×200×50 = 800000  (accurate + good quality research)                │
│    C: 85×50×50  = 212500  (inaccurate but high quality research)            │
│    D: 30×200×50 = 300000  (accurate but low quality research)               │
│    E: 20×50×50  = 50000   (inaccurate + low quality research)               │
│    Total: 2262500                                                           │
│                                                                             │
│  Rewards (1 ETH pool):                                                      │
│    A: 0.398 ETH                                                             │
│    B: 0.354 ETH                                                             │
│    D: 0.133 ETH                                                             │
│    C: 0.094 ETH                                                             │
│    E: 0.022 ETH                                                             │
│                                                                             │
│  ═══════════════════════════════════════════════════                        │
│  FASE 3: WRITE (CRE → blockchain)                                           │
│  ═══════════════════════════════════════════════════                        │
│                                                                             │
│  CRE Step 6a: SUBMIT CONSENSUS                                              │
│  EVMClient.write → ChaosSettlerMarket.submitConsensus(                      │
│    marketId: 1,                                                             │
│    resolution: true,                                                        │
│    workers: [A, B, C, D, E],                                                │
│    qualityScores: [90, 80, 85, 30, 20],                                    │
│    determinations: [true, true, false, true, false]                         │
│  )                                                                          │
│  → Contrato calcula rewards, credita withdrawable, devuelve stakes          │
│                                                                             │
│  CRE Step 6b: PUBLISH REPUTATION                                            │
│  EVMClient.write → ChaosSettlerMarket.publishReputation(                    │
│    marketId: 1,                                                             │
│    workers: [A, B, C, D, E],                                                │
│    qualityScores: [90, 80, 85, 30, 20],                                    │
│    accurate: [true, true, false, true, false]                               │
│  )                                                                          │
│  → Contrato llama giveFeedback() en ERC-8004 por cada worker (oráculo)     │
│                                                                             │
│  ═══════════════════════════════════════════════════                        │
│  FASE 4: WITHDRAW                                                           │
│  ═══════════════════════════════════════════════════                        │
│                                                                             │
│  Worker A → withdraw() → recibe 0.398 ETH + 0.01 ETH stake                 │
│  Worker B → withdraw() → recibe 0.354 ETH + 0.01 ETH stake                 │
│  Worker C → withdraw() → recibe 0.094 ETH + 0.01 ETH stake                 │
│  Worker D → withdraw() → recibe 0.133 ETH + 0.01 ETH stake                 │
│  Worker E → withdraw() → recibe 0.022 ETH + 0.01 ETH stake                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Demo de 3 Mercados: Reputación Acumulada

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  MERCADO 1: "¿Aprobará la SEC un ETF de Solana?"                           │
│  ───────────────────────────────────────────────                            │
│  Worker A: quality=90, accurate → feedback: 90, ACCURATE                    │
│  Worker B: quality=80, accurate → feedback: 80, ACCURATE                    │
│  Worker E: quality=20, wrong    → feedback: 20, INACCURATE                  │
│                                                                             │
│  Después: rep(A)=90, rep(B)=80, rep(E)=20                                  │
│                                                                             │
│  MERCADO 2: "¿Superará Bitcoin los $200k antes de abril?"                   │
│  ───────────────────────────────────────────────                            │
│  Worker A: quality=85, accurate → rep(A) = avg(90,85) = 87                  │
│  Worker E: quality=25, wrong    → rep(E) = avg(20,25) = 22                  │
│  Worker F: quality=70, accurate → rep(F) = 70 (primer mercado)              │
│                                                                             │
│  MERCADO 3: "¿Lanzará Apple un dispositivo AR antes de junio?"              │
│  ──────────────────────────────────────────────────────────                 │
│  Worker A: quality=80, reputation=87 → PESO ALTO en resolución              │
│  Worker E: quality=60, reputation=22 → peso bajo (historial malo)           │
│  Worker F: quality=75, reputation=70 → peso medio                           │
│                                                                             │
│  → A tiene más influencia en la resolución Y gana más reward                │
│  → E necesita muchos mercados buenos para recuperar su reputación           │
│  → ESTO es lo que mostramos en la demo: reputation compounds                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Interacción Worker ↔ CRE ↔ Contrato

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  WORKER (Python/FastAPI)                                                    │
│  ═══════════════════════                                                    │
│                                                                             │
│  Endpoints A2A (oráculo de IA):                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  POST /a2a/resolve                                                    │  │
│  │  Request:  { question: string }                                       │  │
│  │  Response: { determination: bool, reasoning: string,                  │  │
│  │             sources: string[] }                                       │  │
│  │                                                                       │  │
│  │  POST /a2a/challenge                                                  │  │
│  │  Request:  { challenges: string[] }                                   │  │
│  │  Response: { responses: string[] }                                    │  │
│  │                                                                       │  │
│  │  Internamente: usa Claude/GPT para investigar y determinar resultado  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  Registro:                                                                  │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  1. Worker genera wallet (ethers.js / web3.py)                        │  │
│  │  2. Worker llama registerWorker{value: stake}(marketId, endpoint)      │  │
│  │     → Transacción directa al contrato (no necesita SDK ni Gateway)    │  │
│  │  3. Worker levanta FastAPI server en el endpoint registrado            │  │
│  │  4. Espera a que CRE lo contacte                                      │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│                                                                             │
│  CRE WORKFLOW (TypeScript, compilado a WASM, ejecuta en DON)                │
│  ═══════════════════════════════════════════════════════════                │
│                                                                             │
│  Trigger: Cron o EVM Log (resolutionDeadline alcanzado)                     │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                                                                       │  │
│  │  // 1. READ                                                           │  │
│  │  const { workers, endpoints, stakes } =                               │  │
│  │    EVMClient.read(market.getMarketWorkers(marketId));                  │  │
│  │  const reputations = workers.map(w =>                                 │  │
│  │    EVMClient.read(market.getReputation(w)));                           │  │
│  │                                                                       │  │
│  │  // 2. ASK (workers investigan y determinan)                            │  │
│  │  const determinations = await Promise.all(                             │  │
│  │    endpoints.map(ep =>                                                 │  │
│  │      ConfidentialHTTP.post(ep + "/a2a/resolve", { question }))        │  │
│  │  );                                                                   │  │
│  │                                                                       │  │
│  │  // 3. CHALLENGE                                                      │  │
│  │  const challenges = await LLM.generate(                                │  │
│  │    "Generate probing questions for each determination", determinations);│  │
│  │  const responses = await Promise.all(                                  │  │
│  │    endpoints.map((ep, i) =>                                            │  │
│  │      ConfidentialHTTP.post(ep + "/a2a/challenge",                      │  │
│  │        { challenges: challenges[i] }))                                 │  │
│  │  );                                                                   │  │
│  │                                                                       │  │
│  │  // 4. EVALUATE                                                       │  │
│  │  const qualityScores = await LLM.evaluate(                             │  │
│  │    determinations, responses);  // 0-100 per worker                    │  │
│  │                                                                       │  │
│  │  // 5. RESOLVE                                                        │  │
│  │  const resolution = weightedMajority(                                  │  │
│  │    determinations, qualityScores, reputations, stakes);                │  │
│  │                                                                       │  │
│  │  // 6. WRITE                                                          │  │
│  │  EVMClient.write(market.submitConsensus(                               │  │
│  │    marketId, resolution, workers, qualityScores,                       │  │
│  │    determinations.map(d => d.determination)));                         │  │
│  │  EVMClient.write(market.publishReputation(                             │  │
│  │    marketId, workers, qualityScores, accuracy));                       │  │
│  │                                                                       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Qué Construimos

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  CONTRATOS SOLIDITY                                                         │
│  ══════════════════                                                         │
│  1. ChaosSettlerMarket.sol (~200 líneas)                                    │
│     - createMarket, registerWorker, submitConsensus                         │
│     - publishReputation, withdraw, timeout                                  │
│     - getMarketWorkers, getReputation                                       │
│                                                                             │
│  2. ERC8004ReputationRegistry.sol (deploy del estándar)                     │
│     - Si ya existe un deploy de referencia, usarlo                          │
│     - Si no, deployar la implementación del EIP                             │
│                                                                             │
│  CRE WORKFLOW                                                               │
│  ════════════                                                               │
│  3. ChaosSettlerWorkflow.ts (~300 líneas)                                   │
│     - Read → Ask → Challenge → Evaluate → Resolve → Write                  │
│     - Compilado a WASM, ejecuta en DON                                      │
│                                                                             │
│  WORKER AGENT (oráculo de IA)                                               │
│  ════════════════════════════                                               │
│  4. worker_agent.py (~200 líneas)                                           │
│     - FastAPI server con /a2a/resolve y /a2a/challenge                      │
│     - Usa Claude/GPT para investigar y determinar resultado                 │
│     - Script de registro (registerWorker)                                   │
│                                                                             │
│  SCRIPTS / TOOLING                                                          │
│  ════════════════                                                           │
│  5. deploy.sh — Deploy contratos + setup                                    │
│  6. create_market.py — Crear un mercado de prueba                           │
│  7. run_demo.sh — Levantar 3-5 workers, crear 3 mercados, mostrar rep      │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────          │
│  TOTAL: ~700 líneas de código nuevo + deploy scripts                        │
│  DEPENDENCIAS EXTERNAS: 0 (no ChaosChain, no Gateway, no SDK)              │
│  ─────────────────────────────────────────────────────────────────          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Timeline Estimado

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  Semana 1 (Feb 10-16): Make-or-break                                        │
│  ═══════════════════════════════════                                        │
│  □ ChaosSettlerMarket.sol + tests                              (2 días)     │
│  □ Deploy ERC-8004 ReputationRegistry                          (0.5 día)    │
│  □ Worker agent básico (predict + challenge endpoints)         (1 día)      │
│  □ CRE workflow: read + ask (validar que CRE puede HTTP+LLM)  (2 días)     │
│  → Hito: CRE lee workers del contrato y les hace 1 pregunta                │
│                                                                             │
│  Semana 2 (Feb 17-23): Core loop                                            │
│  ═══════════════════════                                                    │
│  □ CRE workflow: challenge + evaluate + resolve                (2 días)     │
│  □ CRE workflow: write (submitConsensus + publishReputation)   (1 día)      │
│  □ Demo de 1 mercado end-to-end                                (1 día)      │
│  □ Refinar worker agent (mejor investigación con LLM)          (1 día)      │
│  → Hito: 1 mercado resuelto end-to-end con rewards + reputation            │
│                                                                             │
│  Semana 3 (Feb 24-Mar 1): Demo + polish                                     │
│  ═══════════════════════════════════                                        │
│  □ Demo de 3 mercados mostrando reputación acumulada           (1 día)      │
│  □ UI mínima (o script) para visualizar el flujo               (1 día)      │
│  □ Integración ChaosChain si v14 convence (OPCIONAL)           (2 días)     │
│  □ Video / presentación                                        (1 día)      │
│  → Hito: Demo completo con reputation compounding                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Lo que Este Approach NO Tiene

```
Honestamente, sin ChaosChain:
- No hay cross-domain reputation (reputation es solo dentro de ChaosSettler)
- No hay studio system (cada mercado es independiente)
- No hay agent identity NFTs (workers son solo addresses)
- No hay SDK para workers (registran directo al contrato)
- No hay narrativa de "infraestructura existente"

Esto se evalúa en v14: qué aporta ChaosChain que justifique la complejidad extra.
```
