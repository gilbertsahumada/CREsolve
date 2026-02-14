# ChaosSettler v14 — Integración Genuina con ChaosChain

> Cómo extender ChaosChain mínimamente para que cada componente tenga un rol real.
> Compara contra v13 (standalone) para evaluar si la complejidad extra vale la pena.
>
> **Framing**: Los workers son **oráculos descentralizados de IA**. No predicen — investigan
> y determinan el resultado real de un evento. CRE evalúa la calidad de su investigación.

---

## Premisa

No reemplazamos componentes de ChaosChain. Los **extendemos**.

```
v11-v12: crear ChaosSettlerResolver que REEMPLAZA RewardsDistributor → 6 problemas
v13:     ignorar ChaosChain, contrato standalone → 0 problemas, 0 ChaosChain
v14:     AGREGAR funcionalidad a contratos existentes → integración genuina
```

---

## Cambios Necesarios en ChaosChain

### Cambio 1: StudioProxy — SIN CAMBIOS

```
StudioProxy NO se modifica. registerAgent() queda tal cual:
  registerAgent(uint256 agentId, AgentRole role) external payable

El endpoint A2A del worker ya está en la metadata URI de su agent NFT
(ERC-8004 Identity Registry → tokenURI → JSON → endpoints[]).

El worker incluye su A2A endpoint al mintear/actualizar su agent NFT:

  "endpoints": [
    {"name": "agentWallet", "endpoint": "eip155:11155111:0xABC..."},
    {"name": "a2a", "endpoint": "https://agent-a.example/a2a"}
  ]

CRE lee los endpoints así:
  1. EVMClient.read → StudioProxy.getAgentId(workerAddress)     → agentId
  2. EVMClient.read → IdentityRegistry.tokenURI(agentId)        → URI
  3. HTTPClient.get → fetch URI                                   → JSON
  4. Parse JSON → endpoints.find(e => e.name == "a2a").endpoint  → URL

No se duplica data. El endpoint vive donde corresponde: en la identidad.
```

### Cambio 2: RewardsDistributor — agregar resolveAndDistribute (~65 líneas)

```solidity
// NUEVO: authorized callers (para CRE DON address)
mapping(address => bool) public authorizedResolvers;

modifier onlyOwnerOrResolver() {
    require(
        msg.sender == owner() || authorizedResolvers[msg.sender],
        "Not authorized"
    );
    _;
}

function setAuthorizedResolver(address resolver, bool authorized)
    external onlyOwner
{
    authorizedResolvers[resolver] = authorized;
    emit ResolverUpdated(resolver, authorized);
}

// NUEVO: función principal para ChaosSettler
function resolveAndDistribute(
    address studio,
    uint64 epoch,
    address[] calldata workers,
    uint8[] calldata qualityScores,    // 0-100
    bool[] calldata determinations,   // qué determinó cada oráculo
    bool resolution
) external onlyOwnerOrResolver {
    require(studio != address(0), "Invalid studio");
    require(workers.length > 0 && workers.length <= 10, "Invalid worker count");
    require(workers.length == qualityScores.length, "Length mismatch");
    require(workers.length == determinations.length, "Length mismatch");

    IStudioProxy proxy = IStudioProxy(studio);

    // --- Calcular reward pool (escrow total - stakes de workers) ---
    uint256 totalStakes = 0;
    uint256[] memory workerAgentIds = new uint256[](workers.length);

    for (uint i = 0; i < workers.length; i++) {
        workerAgentIds[i] = proxy.getAgentId(workers[i]);
        require(workerAgentIds[i] != 0, "Worker not registered");
        totalStakes += proxy.getAgentStake(workerAgentIds[i]);
    }

    uint256 rewardPool = proxy.totalEscrow() - totalStakes;
    require(rewardPool > 0, "No reward pool");

    // --- Calcular weights ---
    uint256[] memory weights = new uint256[](workers.length);
    uint256 totalWeight = 0;

    for (uint i = 0; i < workers.length; i++) {
        uint256 correctnessMult = (determinations[i] == resolution) ? 200 : 50;
        uint256 reputation = _getAgentReputation(workerAgentIds[i]);
        weights[i] = uint256(qualityScores[i]) * correctnessMult * reputation;
        totalWeight += weights[i];
    }

    require(totalWeight > 0, "Zero total weight");

    // --- Distribuir rewards ---
    uint256 totalDistributed = 0;
    for (uint i = 0; i < workers.length; i++) {
        uint256 reward = (rewardPool * weights[i]) / totalWeight;
        if (reward > 0) {
            proxy.releaseFunds(workers[i], reward, bytes32(0));
            totalDistributed += reward;
        }
        // Devolver stake al worker
        uint256 stake = proxy.getAgentStake(workerAgentIds[i]);
        if (stake > 0) {
            proxy.releaseFunds(workers[i], stake, bytes32(0));
        }
    }

    // --- Publicar reputación via ERC-8004 ---
    address repRegistry = IChaosChainRegistry(proxy.registry())
        .getReputationRegistry();

    for (uint i = 0; i < workers.length; i++) {
        bool wasAccurate = determinations[i] == resolution;
        IReputationRegistry(repRegistry).giveFeedback(
            workerAgentIds[i],
            int128(uint128(qualityScores[i])),
            0,
            "RESOLUTION_QUALITY",
            wasAccurate ? "ACCURATE" : "INACCURATE",
            "",              // endpoint: vive en metadata URI del NFT
            "",              // feedbackURI: opcional
            bytes32(0)       // feedbackHash: opcional
        );
    }

    // --- Registrar en epoch tracking ---
    bytes32 dataHash = keccak256(
        abi.encodePacked(studio, epoch, resolution)
    );
    _epochWork[studio][epoch].push(dataHash);

    emit EpochClosed(studio, epoch, totalDistributed, 0);
}

// NUEVO: leer reputación de ERC-8004, default 50
function _getAgentReputation(uint256 agentId)
    internal view returns (uint256)
{
    // Lee último feedback de ERC-8004 para este agentId
    // Si no tiene historial → return 50 (neutral)
    // Para hackathon: promedio simple de quality scores anteriores
    // TODO: implementar lectura del registry
    return 50;
}
```

**Impacto**: Función nueva, no modifica funciones existentes. closeEpoch() intacto.
Los tests existentes no se rompen.

### Cambio 3: Autorización de CRE (~1 línea de setup)

```
Después del deploy, el admin (owner de RewardsDistributor) ejecuta:

rewardsDistributor.setAuthorizedResolver(CRE_DON_ADDRESS, true)

Esto autoriza al CRE DON a llamar resolveAndDistribute().
Es una transacción de setup, no un cambio de código.
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
│  1. ChaosCore.createStudio("ChaosSettler Market #1", predictionMarketLogic) │
│     → Deploya StudioProxy con RewardsDistributor del registry               │
│     → StudioProxy tiene: escrow, registerAgent, withdraw                    │
│                                                                             │
│  2. Admin autoriza CRE:                                                     │
│     rewardsDistributor.setAuthorizedResolver(CRE_DON, true)                │
│     (una sola vez, no por mercado)                                          │
│                                                                             │
│  3. Creador del mercado deposita reward pool:                               │
│     studioProxy.deposit{value: 1 ETH}()                                    │
│     (o envía ETH directo al StudioProxy via receive())                      │
│                                                                             │
│  4. Workers se registran:                                                   │
│     a) Mintear agent NFT con A2A endpoint en metadata (si no lo tiene)      │
│        → metadata.endpoints = [{name:"a2a", endpoint:"https://..."}]        │
│     b) studioProxy.registerAgent{value: 0.01 ETH}(                         │
│          agentId,           // ERC-8004 identity NFT                        │
│          AgentRole.WORKER                                                   │
│        )                                                                    │
│     → Requiere: agent NFT en ERC-8004 Identity Registry                    │
│     → Almacena: agentId, role, stake                                        │
│     → Endpoint vive en metadata URI del NFT (no en StudioProxy)             │
│     → Max 10 workers (validado en resolveAndDistribute)                     │
│                                                                             │
│  ═══════════════════════════════════════════════════                        │
│  FASE 2: CRE RESOLUTION                                                     │
│  ═══════════════════════════════════════════════════                        │
│                                                                             │
│  5. CRE trigger: resolutionDeadline (Cron o EVM Log)                        │
│                                                                             │
│  6. READ                                                                    │
│     a) EVMClient.read → leer AgentRegistered events del StudioProxy         │
│        → addresses, agentIds, stakes                                        │
│     b) Per worker: EVMClient.read → IdentityRegistry.tokenURI(agentId)      │
│        → HTTPClient.get(uri) → parse JSON → extract A2A endpoint            │
│     c) Per worker: EVMClient.read → ReputationRegistry.getFeedback(agentId) │
│        → reputation score                                                   │
│                                                                             │
│  7. ASK — Confidential HTTP → worker A2A endpoints (oráculos)               │
│     → POST https://agent-X/a2a/resolve                                      │
│     → Workers investigan y responden: determination + evidence              │
│                                                                             │
│  8. CHALLENGE — Confidential HTTP → LLM + worker A2A                        │
│     → LLM genera preguntas, CRE envía a workers, workers responden         │
│                                                                             │
│  9. EVALUATE — Confidential HTTP → LLM                                      │
│     → quality scores: 0-100 per worker                                      │
│                                                                             │
│  10. RESOLVE — cómputo puro en DON                                          │
│      → resolution = weighted_majority(determinations, quality, rep, stake)   │
│                                                                             │
│  ═══════════════════════════════════════════════════                        │
│  FASE 3: WRITE                                                               │
│  ═══════════════════════════════════════════════════                        │
│                                                                             │
│  11. CRE → EVMClient.write:                                                 │
│      rewardsDistributor.resolveAndDistribute(                               │
│        studio, epoch, workers, qualityScores, determinations, resolution    │
│      )                                                                      │
│      → RewardsDistributor calcula weights y rewards                         │
│      → RewardsDistributor llama StudioProxy.releaseFunds() per worker       │
│      → RewardsDistributor publica reputación en ERC-8004                    │
│      → RewardsDistributor registra epoch                                    │
│                                                                             │
│  (Nota: si CRE también necesita resolver un PredictionMarket externo:       │
│   CRE → predictionMarket.resolve(marketId, resolution)                      │
│   Eso es independiente de ChaosChain)                                       │
│                                                                             │
│  ═══════════════════════════════════════════════════                        │
│  FASE 4: WITHDRAW                                                            │
│  ═══════════════════════════════════════════════════                        │
│                                                                             │
│  12. Workers llaman studioProxy.withdraw()                                  │
│      → Reciben reward + stake de vuelta                                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Rol de Cada Componente (Genuino, No Forzado)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  COMPONENTE               │ ROL                         │ POR QUÉ ES REAL   │
│  ─────────────────────────┼─────────────────────────────┼──────────────────  │
│  StudioProxy              │ Registration + escrow       │ registerAgent,     │
│                           │ + withdraw                  │ escrow, withdraw   │
│                           │                             │ SIN CAMBIOS        │
│                           │                             │                    │
│  RewardsDistributor       │ Reward calculation +        │ NUEVA función que  │
│                           │ distribution + reputation   │ usa infraestructura│
│                           │ publishing                  │ existente: release │
│                           │                             │ Funds, ERC-8004,   │
│                           │                             │ epoch tracking     │
│                           │                             │                    │
│  ERC-8004 Reputation      │ Cross-domain reputation     │ Built-in en       │
│  Registry                 │ acumulada                   │ resolveAndDistri-  │
│                           │                             │ bute, no add-on    │
│                           │                             │                    │
│  ERC-8004 Identity        │ Agent identity NFT +        │ registerAgent      │
│  Registry                 │ A2A endpoint storage        │ verifica ownership │
│                           │ (via metadata URI)          │ del NFT. CRE lee   │
│                           │                             │ endpoints de aquí  │
│                           │                             │                    │
│  ChaosCore                │ Studio creation +           │ createStudio ya    │
│                           │ studio tracking             │ existe, sin cambio │
│                           │                             │                    │
│  Studio system            │ Organiza workers por        │ Cada mercado = 1   │
│  (concepto)               │ mercado/workspace           │ studio. Tracking   │
│                           │                             │ natural.           │
│                           │                             │                    │
│  Gateway                  │ NO se usa para resolución   │ CRE escribe        │
│                           │ (CRE lo reemplaza)          │ directo via        │
│                           │                             │ EVMClient. Gateway │
│                           │                             │ sigue sirviendo    │
│                           │                             │ para otros studios │
│                           │                             │ (música, código)   │
│                           │                             │                    │
│  SDK                      │ Workers registran           │ Wrapper para       │
│                           │                             │ registerAgent con  │
│                           │                             │ endpoint. Puede    │
│                           │                             │ ser directo a      │
│                           │                             │ contrato (no       │
│                           │                             │ necesita Gateway)  │
│                           │                             │                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Lo que Ganamos vs v13 (Standalone)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  1. CROSS-DOMAIN REPUTATION                                                 │
│  ──────────────────────────                                                 │
│  ChaosChain tiene UN reputation registry compartido entre todos los studios.│
│  Un worker que construyó reputación en un studio de música lleva esa        │
│  reputación al prediction market.                                           │
│                                                                             │
│  Esto es IMPOSIBLE con v13 — ahí la reputación es solo dentro de            │
│  ChaosSettlerMarket. No hay cross-domain.                                   │
│                                                                             │
│  Demo:                                                                      │
│  Studio "MusicCollab" → Worker A quality=85 → rep(A) sube                   │
│  Studio "ChaosSettler" → Worker A llega con rep alta → más peso             │
│  → Su reputación de un dominio mejora su posición en otro                   │
│                                                                             │
│  2. AGENT IDENTITY NFT                                                      │
│  ──────────────────────                                                     │
│  Workers necesitan un ERC-8004 agent NFT para registrarse.                  │
│  Esto es identidad verificable on-chain: "este agent existe, tiene          │
│  historial, tiene reputación".                                              │
│                                                                             │
│  v13 solo usa addresses. Cualquiera puede crear 10 wallets y registrarse.   │
│  Con NFT identity, hay un costo de crear identidad (mint NFT) que           │
│  desincentiva sybil attacks.                                                │
│                                                                             │
│  3. BATTLE-TESTED ESCROW                                                    │
│  ──────────────────────                                                     │
│  StudioProxy tiene pull payment pattern + nonReentrant + audited escrow.    │
│  v13 reimplementa esto (~30 líneas). Funciona, pero es código nuevo         │
│  sin auditar.                                                               │
│                                                                             │
│  4. STUDIO SYSTEM                                                           │
│  ────────────────                                                           │
│  Cada mercado = 1 studio. ChaosCore trackea todos los studios.              │
│  Hay un registro centralizado de todos los mercados que se resolvieron.     │
│  v13 no tiene esto — cada ChaosSettlerMarket es independiente.              │
│                                                                             │
│  5. EPOCH TRACKING                                                          │
│  ────────────────                                                           │
│  resolveAndDistribute registra en _epochWork. Queda historial on-chain      │
│  de todas las resoluciones. Queries futuras pueden leer esto.               │
│                                                                             │
│  6. REPUTATION PUBLISHING BUILT-IN                                          │
│  ──────────────────────────────                                             │
│  resolveAndDistribute llama giveFeedback() internamente.                    │
│  Es una transacción atómica: rewards + reputation en 1 tx.                  │
│  v13 necesita 2 tx separadas (submitConsensus + publishReputation).         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Lo que Pagamos vs v13

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  1. StudioProxy: SIN CAMBIOS                                                │
│     → 0 líneas de Solidity modificadas                                      │
│     → 0 tests rotos                                                         │
│                                                                             │
│  2. Agregar resolveAndDistribute() a RewardsDistributor                     │
│     → ~65 líneas de Solidity (función nueva, no modifica existente)          │
│     → Tests nuevos para esta función                                        │
│     → ~2 horas de trabajo                                                   │
│                                                                             │
│  3. Setup admin                                                             │
│     → setAuthorizedResolver(CRE_DON, true) — 1 transacción                 │
│     → ChaosCore.createStudio() — 1 transacción                              │
│     → deposit() — 1 transacción                                             │
│     → Script de deploy: ~50 líneas                                          │
│                                                                             │
│  4. Workers necesitan agent NFT                                             │
│     → Mint ERC-8004 identity antes de registrarse                           │
│     → 1 transacción extra por worker (solo primera vez)                     │
│                                                                             │
│  5. Dependencia de contratos existentes                                     │
│     → Si un contrato tiene bug, afecta a ChaosSettler                       │
│     → Pero estos contratos ya están testeados (236 tests)                   │
│                                                                             │
│  TOTAL COSTO EXTRA vs v13:                                                  │
│  ~65 líneas Solidity (solo RewardsDistributor) + ~50 líneas deploy script   │
│  StudioProxy: 0 cambios. Tests existentes: 0 rotos.                         │
│  Workers: necesitan A2A endpoint en metadata de su NFT (ya es el pattern)   │
│  Estimado: 1 día de trabajo adicional                                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Demo: Cross-Domain Reputation

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  DEMO SCRIPT (3 minutos)                                                    │
│  ═══════════════════════                                                    │
│                                                                             │
│  Acto 1: "Worker A es músico"                                               │
│  ─────────────────────────────                                              │
│  → Studio "MusicCollab" ya existe en ChaosChain                             │
│  → Worker A participó en 2 sesiones, calidad alta                           │
│  → Reputación actual: 85/100                                                │
│  → Mostramos: ERC-8004 feedback history de Worker A                         │
│                                                                             │
│  Acto 2: "Worker A quiere resolver prediction markets"                      │
│  ─────────────────────────────────────────────────────                      │
│  → Nuevo studio ChaosSettler para "¿Aprobará SEC ETF Solana?"              │
│  → Worker A se registra con stake + endpoint                                │
│  → Worker E (nuevo, rep=50) también se registra                             │
│  → CRE lee reputaciones: A=85, E=50                                        │
│                                                                             │
│  Acto 3: "CRE resuelve via oráculos de IA"                                  │
│  ──────────────────────────────────────────                                 │
│  → CRE interroga ambos workers (oráculos)                                   │
│  → Worker A: quality=90, determina YES                                      │
│  → Worker E: quality=40, determina NO                                       │
│  → Resolución: YES (A tiene más peso por reputación)                        │
│                                                                             │
│  Acto 4: "Rewards reflejan reputación cross-domain"                         │
│  ──────────────────────────────────────────────────                         │
│  → Worker A: weight = 90 × 200 × 85 = 1,530,000                            │
│  → Worker E: weight = 40 × 50 × 50  = 100,000                              │
│  → Worker A: 0.94 ETH (reputación de música ayudó!)                        │
│  → Worker E: 0.06 ETH                                                       │
│                                                                             │
│  Acto 5: "Reputation compounds"                                             │
│  ──────────────────────────────                                             │
│  → Worker A: rep ahora 87 (subió por buena investigación en resolución)     │
│  → Worker E: rep ahora 35 (bajó por mal trabajo)                            │
│  → Si Worker A vuelve a MusicCollab, su rep mejorada le beneficia           │
│  → ESO es cross-domain reputation. Solo posible con ChaosChain.             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Comparación Directa: v13 vs v14

```
┌───────────────────────┬──────────────────────┬───────────────────────┐
│                       │  v13 (Standalone)    │  v14 (ChaosChain)     │
├───────────────────────┼──────────────────────┼───────────────────────┤
│ Contratos nuevos      │ 1 (200 líneas)       │ 0 nuevos              │
│ Contratos modificados │ 0                    │ 1 (+65 líneas)        │
│ Reputation            │ ERC-8004 standalone  │ ERC-8004 built-in     │
│ Cross-domain rep      │ ❌ no posible         │ ✅ compartido          │
│ Agent identity        │ Solo addresses       │ ERC-8004 NFT          │
│ Sybil resistance      │ Solo stake           │ Stake + NFT identity  │
│ Escrow                │ Custom (~30 líneas)  │ StudioProxy (audited) │
│ Studio tracking       │ ❌ no                 │ ✅ ChaosCore           │
│ Epoch history         │ ❌ no                 │ ✅ _epochWork          │
│ Rewards + rep atomico │ ❌ 2 transacciones    │ ✅ 1 transacción       │
│ Admin setup           │ 0 transacciones      │ 3 transacciones       │
│ Gateway               │ No se usa            │ No se usa*            │
│ SDK                   │ No se usa            │ Opcional para registro│
│ Tiempo extra          │ baseline             │ +1 día                │
│ Riesgo                │ Muy bajo             │ Bajo                  │
│ Narrativa hackathon   │ "ERC-8004 reputation"│ "ChaosChain AI oracle │
│                       │                      │  resolution with      │
│                       │                      │  cross-domain rep"    │
├───────────────────────┼──────────────────────┼───────────────────────┤
│ Lines of code total   │ ~700                 │ ~665 (+65 Solidity    │
│                       │                      │  -100 escrow propio)  │
└───────────────────────┴──────────────────────┴───────────────────────┘

* Gateway sigue funcionando para otros studios. No se usa en el flujo
  ChaosSettler porque CRE escribe directo via EVMClient. Si se quiere
  Gateway como intermediario (crash recovery, logging), es un upgrade
  de producción: nuevo workflow "cre-resolution" en Gateway (~100 líneas TS).
```

---

## Arquitectura Visual

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  WORKER                    CHAOSCHAIN                    CRE DON            │
│  ══════                    ══════════                    ═══════             │
│                                                                             │
│  1. Mint Agent NFT ───→  ERC-8004 Identity Registry                        │
│                          (agent NFT = identidad)                            │
│                                                                             │
│  2. Register ──────────→ StudioProxy.registerAgent()                        │
│     + stake               (agentId, role)  ← SIN CAMBIOS                   │
│                          ┌──────────────────────┐                           │
│                          │ Storage:             │                           │
│                          │  agentId   ✓         │                           │
│                          │  role      ✓         │                           │
│                          │  stake     ✓         │                           │
│                          │  (endpoint vive en   │                           │
│                          │   metadata del NFT)  │                           │
│                          └──────────────────────┘                           │
│                                                                             │
│  3. Creator deposits ──→ StudioProxy (escrow)                               │
│     reward pool           _totalEscrow += msg.value                         │
│                                                                             │
│                          ┌──────────────────────┐                           │
│                          │ StudioProxy          │◄─── CRE lee agentIds     │
│                          │  → agentIds, stakes   │     (EVMClient.read)     │
│                          └──────────────────────┘                           │
│                          ┌──────────────────────┐                           │
│                          │ ERC-8004 Identity    │◄─── CRE lee endpoints    │
│                          │  tokenURI(agentId)    │     (EVMClient.read      │
│                          │  → JSON metadata      │      + HTTPClient.get)   │
│                          │  → a2a endpoint       │                           │
│                          └──────────────────────┘                           │
│                                                                             │
│  ┌──────────────┐                                    ┌──────────────┐      │
│  │ Worker A2A   │◄───── Confidential HTTP ───────────│ CRE Workflow │      │
│  │ /a2a/resolve │                                    │              │      │
│  │ /a2a/chall.  │────── responses ──────────────────→│ ask          │      │
│  └──────────────┘                                    │ challenge    │      │
│                                                      │ evaluate     │      │
│                                LLM API ◄─────────────│ resolve      │      │
│                                                      │ write ───────┤      │
│                                                      └──────┬───────┘      │
│                                                             │               │
│                          ┌──────────────────────┐           │               │
│                          │ RewardsDistributor   │◄──────────┘               │
│                          │ .resolveAndDistribute │  EVMClient.write         │
│                          │  (NUEVA función)      │                          │
│                          │                       │                          │
│                          │ Internamente:         │                          │
│                          │ ├─ valida workers     │                          │
│                          │ ├─ calcula weights    │                          │
│                          │ ├─ calcula rewards    │                          │
│                          │ ├─ releaseFunds() ────┤──→ StudioProxy          │
│                          │ ├─ giveFeedback() ────┤──→ ERC-8004 Reputation  │
│                          │ └─ registra epoch     │                          │
│                          └──────────────────────┘                           │
│                                                                             │
│  4. Workers withdraw ──→ StudioProxy.withdraw()                             │
│     (reward + stake)      _withdrawable[worker] → transfer                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Qué Construimos (lista final v14)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  MODIFICAR EN CHAOSCHAIN (contratos existentes)                             │
│  ══════════════════════════════════════════════                              │
│  □ StudioProxy — SIN CAMBIOS (0 líneas)                                     │
│  □ RewardsDistributor.resolveAndDistribute() — nueva función  (+50 líneas)  │
│  □ RewardsDistributor.setAuthorizedResolver() — nueva función (+5 líneas)   │
│  □ RewardsDistributor._getAgentReputation() — helper          (+10 líneas)  │
│  □ Tests nuevos para resolveAndDistribute (no rompe tests existentes)        │
│                                                                             │
│  CREAR NUEVO                                                                │
│  ═══════════                                                                │
│  □ CRE Resolution Workflow (TypeScript, ~300 líneas)                        │
│    - Read workers (oráculos) + endpoints + reputation de StudioProxy        │
│    - Ask + Challenge + Evaluate via Confidential HTTP + LLM                 │
│    - Resolve (weighted majority de determinaciones)                          │
│    - Write: resolveAndDistribute()                                          │
│                                                                             │
│  □ Worker Agent — oráculo de IA (Python, FastAPI, ~200 líneas)              │
│    - POST /a2a/resolve, POST /a2a/challenge                                 │
│    - Investiga y determina resultado (no predice)                            │
│    - Registration script (mint NFT con A2A endpoint + registerAgent)         │
│                                                                             │
│  □ PredictionMarket.sol (~100 líneas) — OPCIONAL                            │
│    - Si queremos que CRE también resuelva un mercado de apuestas            │
│    - createMarket(), resolve() onlyCRE                                      │
│    - Independiente de ChaosChain (contrato aparte)                          │
│                                                                             │
│  SCRIPTS                                                                    │
│  ═══════                                                                    │
│  □ deploy_chaossettler.sh — setup script                                    │
│    - createStudio()                                                         │
│    - setAuthorizedResolver()                                                │
│    - deposit() reward pool                                                  │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────          │
│  TOTAL MODIFICADO: ~65 líneas de Solidity en RewardsDistributor             │
│  TOTAL NUEVO: ~600 líneas (CRE workflow + worker agent + scripts)           │
│  TOTAL: ~665 líneas (menos que v13 porque StudioProxy hace el escrow)       │
│  StudioProxy: SIN CAMBIOS. Endpoints en metadata URI del agent NFT.         │
│  ─────────────────────────────────────────────────────────────────          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Decisión: ¿v13 o v14?

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  Elige v13 si:                                                              │
│  - Quieres el path más rápido sin tocar ChaosChain                          │
│  - El hackathon NO evalúa "uso de infraestructura existente"                │
│  - Prefieres 0 riesgo de romper algo existente                              │
│                                                                             │
│  Elige v14 si:                                                              │
│  - Cross-domain reputation es un diferenciador para el hackathon            │
│  - ChaosChain como plataforma importa para la narrativa                     │
│  - 1 día extra de trabajo es aceptable por mejor integración                │
│  - El demo de "reputación de música → prediction markets" es potente        │
│                                                                             │
│  Los dos paths son viables. v13 es el fallback seguro.                      │
│  v14 es la apuesta por una narrativa más fuerte.                            │
│                                                                             │
│  Recomendación: empezar con v14. Si los cambios de contrato causan          │
│  problemas, revertir a v13 en < 2 horas (el CRE workflow y worker agent    │
│  son los mismos en ambos paths).                                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```
