# ChaosSettler — Análisis de Scoring Multi-dimensional + Confidencialidad

> Análisis de cómo implementar el scoring de 8 dimensiones preservando la confidencialidad
> de las determinaciones individuales de cada oráculo worker.
>
> **Decisión**: Opción 4 (Multi-dimensional Blindado) implementada. Ver §5.
> **Dimensiones on-chain**: Solo 3 custom (Resolution Quality, Source Quality, Analysis Depth).
> **Dimensiones off-chain**: 5 PoA universales se evalúan en CRE TEE pero no se publican.

---

## 1. Qué se expone HOY (todo público en calldata + eventos)

| Dato | Dónde se expone | Qué revela |
|------|-----------------|------------|
| `workers[]` | calldata de `resolveAndDistribute` | Quiénes participaron |
| `qualityScores[]` | calldata | Qué tan buenos fueron |
| `determinations[]` | calldata | **QUÉ VOTÓ CADA UNO** |
| `resolution` | calldata + evento | Respuesta final |
| tag2 `"ACCURATE"/"INACCURATE"` | `giveFeedback` evento `NewFeedback` | **Quién acertó/falló** |
| montos de `releaseFunds` | eventos `FundsReleased` | Proporciones del reward |

### El problema

Aunque escondamos `determinations[]` del calldata, el tag `ACCURATE/INACCURATE` en `giveFeedback`
**revela exactamente lo mismo**. Si alguien consulta:

```
readAllFeedback(agentId, ..., "RESOLUTION_QUALITY", "ACCURATE")
```

Puede inferir el historial de votos del agente correlacionando con el `resolution` de cada mercado.

---

## 2. Frontera de confidencialidad natural: CRE

```
┌─────────────────────────────────────────────────────┐
│  CRE — CÓMPUTO CONFIDENCIAL (Pasos 1-5)            │
│                                                     │
│  ✓ Qué determinó cada worker (verdadero/falso)      │
│  ✓ Evidencia y fuentes de cada worker               │
│  ✓ Preguntas y respuestas del challenge             │
│  ✓ Scores por dimensión (8 dimensiones)             │
│  ✓ Cálculo del multiplicador de correctitud         │
│  ✓ Voto ponderado mayoritario                       │
└────────────────────┬────────────────────────────────┘
                     │ onReport() — SOLO lo necesario
┌────────────────────▼────────────────────────────────┐
│  ON-CHAIN (público para siempre)                    │
│                                                     │
│  ? ¿Qué escribimos aquí?                            │
└─────────────────────────────────────────────────────┘
```

Lo **mínimo** que necesitamos on-chain:
- **Distribución**: quién recibe cuánto
- **Reputación**: algún score por agente
- **Mercado**: el resultado (resolución)

Lo que **NO necesitamos** on-chain: determinaciones individuales, quality scores crudos.

---

## 3. Las 4 Opciones

---

### Opción 1: Transparencia Total (estado actual)

```solidity
// Firma actual — TODO público
resolveAndDistribute(
    studio, epoch,
    workers[],
    qualityScores[],     // 0-100 por worker
    determinations[],    // verdadero/falso por worker
    resolution           // respuesta final
)

// Reputación: 1 giveFeedback por worker
// tag1 = "RESOLUTION_QUALITY"
// tag2 = "ACCURATE" o "INACCURATE"
```

| Aspecto | Valor |
|---------|-------|
| Confidencialidad | **Ninguna** — votos, scores, precisión, todo visible |
| Verificabilidad | **Máxima** — cualquiera puede recalcular los rewards |
| Reputación | 1 dimensión (RESOLUTION_QUALITY) con tag de precisión |
| Gas | Bajo (~1 giveFeedback por worker) |
| Complejidad | Baja |

**Riesgo**: Un worker puede ver el historial de votos de todos los demás. Un creador de mercado
podría sobornar workers específicos sabiendo sus tendencias.

---

### Opción 2: Pesos Pre-computados (esconder votos)

```solidity
// Firma modificada — sin determinations ni qualityScores
resolveAndDistribute(
    studio, epoch,
    workers[],
    weights[],       // pre-computado en CRE: calidad × multCorrectitud × reputación
    resolution
)

// Reputación: 1 giveFeedback por worker
// tag1 = "RESOLUTION_QUALITY"
// tag2 = "" ← SIN tag de precisión
```

| Aspecto | Valor |
|---------|-------|
| Confidencialidad | **Buena** — votos individuales ocultos |
| Verificabilidad | **Parcial** — se confía en CRE para el cálculo de pesos |
| Reputación | 1 dimensión, sin tag de precisión (el score ya incorpora correctitud) |
| Gas | Bajo |
| Complejidad | Baja — cambio menor al contrato |

**Cómo funciona**: CRE computa `peso[i] = calidad × (acertó ? 200 : 50) × reputación` off-chain.
El contrato solo ve un peso final por worker y distribuye proporcionalmente. El tag de reputación
NO dice ACCURATE/INACCURATE — solo el score numérico (que ya refleja la correctitud en su magnitud).

**Qué puede inferir un observador**: Si Worker A recibe 80% del reward y Worker B recibe 20%,
sabe que A tuvo un peso mucho mayor. Pero no sabe si es por mejor calidad, mejor reputación,
o por haber acertado. No puede deducir el voto individual con certeza.

---

### Opción 3: Multi-dimensional Transparente

```solidity
// Firma actual + 8 llamadas a giveFeedback por worker
resolveAndDistribute(
    studio, epoch,
    workers[],
    qualityScores[],
    determinations[],
    resolution
)

// Reputación: 8 giveFeedback por worker:
//   ("INITIATIVE",          "ACCURATE"/"INACCURATE")
//   ("COLLABORATION",       "ACCURATE"/"INACCURATE")
//   ("REASONING_DEPTH",     "ACCURATE"/"INACCURATE")
//   ("COMPLIANCE",          "ACCURATE"/"INACCURATE")
//   ("EFFICIENCY",          "ACCURATE"/"INACCURATE")
//   ("RESOLUTION_QUALITY",  "ACCURATE"/"INACCURATE")
//   ("SOURCE_QUALITY",      "ACCURATE"/"INACCURATE")
//   ("ANALYSIS_DEPTH",      "ACCURATE"/"INACCURATE")
```

| Aspecto | Valor |
|---------|-------|
| Confidencialidad | **Ninguna** — peor que Opción 1 (más datos expuestos) |
| Verificabilidad | **Máxima** |
| Reputación | **8 dimensiones** — el diferenciador de ChaosChain |
| Gas | **Alto** — 8 × N workers × giveFeedback (~8x más gas) |
| Complejidad | Media — más llamadas pero misma lógica |

**Problema**: El gas es ~8x mayor, pero la reputación on-chain es riquísima.
Sin embargo, CERO confidencialidad.

---

### Opción 4: Multi-dimensional Blindado (recomendada)

```solidity
// Firma modificada
resolveAndDistribute(
    studio, epoch,
    workers[],
    weights[],           // pre-computado en CRE (oculta calidad, correctitud, reputación)
    dimScores[],         // arreglo plano: [w0_dim0, w0_dim1, w0_dim2, w1_dim0, ...]
    resolution
)

// Reputación: 3 giveFeedback por worker (solo dims custom):
//   ("RESOLUTION_QUALITY", "")   ← score sin tag de precisión
//   ("SOURCE_QUALITY", "")       ← score sin tag de precisión
//   ("ANALYSIS_DEPTH", "")       ← score sin tag de precisión
```

| Aspecto | Valor |
|---------|-------|
| Confidencialidad | **Buena** — votos ocultos, no se revela precisión |
| Verificabilidad | **Parcial** — pesos verificables, dimensiones on-chain |
| Reputación | **3 dimensiones custom** — diferenciador sin exponer votos |
| Gas | **Moderado** — 3 giveFeedback por worker (~3x vs Opción 1) |
| Complejidad | Media |

**Cómo funciona**:

1. CRE evalúa las 8 dimensiones off-chain (Paso 4)
2. Las 5 PoA universales se quedan en CRE (no se necesitan para ChaosSettler)
3. Las 3 dimensiones custom se escriben on-chain como reputación separada
4. `weights[]` incorpora correctitud × calidad × reputación (blindado)
5. `dimScores[]` son los scores por dimensión **sin revelar precisión**
6. Un observador ve: "Worker A tiene Calidad de Resolución 85, Calidad de Fuentes 70, Profundidad de Análisis 60"
   pero NO sabe si votó VERDADERO o FALSO

**Por qué las 5 PoA se quedan off-chain**: Las dimensiones PoA universales (Iniciativa,
Colaboración, etc.) son evaluadas por el flujo closeEpoch existente de ChaosChain.
ChaosSettler solo publica sus 3 dimensiones propias. Si en el futuro queremos publicar
las 8, se puede extender.

---

## 4. Comparación

```
                    Confidencialidad    Reputación    Gas       Verificabilidad
                    ─────────────────   ──────────    ───       ───────────────
Opción 1: Transp.   ✗ Ninguna          1 dim         Bajo      ✓ Total
Opción 2: Blindado  ✓ Buena            1 dim         Bajo      ~ Parcial
Opción 3: Multi-T   ✗ Ninguna          8 dims        Alto      ✓ Total
Opción 4: Multi-B   ✓ Buena            3 dims        Medio     ~ Parcial
```

---

## 5. Recomendación: Opción 4 — Multi-dimensional Blindado ✅ IMPLEMENTADA

> **Estado**: Implementada en `RewardsDistributor.sol` (rama `hackathon/chaos-settler`).
> La firma de `resolveAndDistribute()` usa `weights[]` + `dimScores[]`.
> `_publishResolutionReputation()` publica 3 dimensiones sin tag ACCURATE/INACCURATE.
> Las 5 dimensiones PoA universales se evalúan en CRE pero no se publican on-chain
> (son para el flujo closeEpoch() de ChaosChain que no usamos).

La razón es que balancea los tres objetivos:

### 5.1 Confidencialidad

Los votos individuales se quedan en CRE. No se puede reconstruir qué determinó
cada worker a partir de los datos on-chain.

### 5.2 Reputación rica

3 dimensiones on-chain (Calidad de Resolución, Calidad de Fuentes, Profundidad de Análisis)
es el diferenciador real de ChaosChain — cualquier protocolo puede hacer "pagaste bien o mal",
pero ChaosChain publica *por qué* un agente es bueno o malo, en múltiples ejes.

### 5.3 Gas razonable

3 llamadas en vez de 8 por worker. Para 3 workers son 9 giveFeedback en total — factible.

---

## 6. Cambios requeridos para Opción 4

### 6.1 Contrato: `resolveAndDistribute` — nueva firma

```solidity
function resolveAndDistribute(
    address studio,
    uint64 epoch,
    address[] calldata workers,
    uint256[] calldata weights,       // pre-computado: calidad × multCorrectitud × rep
    uint8[] calldata dimScores,       // plano: [w0_calidadRes, w0_calidadFuentes, w0_análisis, w1_calidadRes, ...]
    bool resolution
) external onlyOwnerOrResolver {
    require(workers.length > 0, "Sin workers");
    require(workers.length <= 10, "Demasiados workers");
    require(workers.length == weights.length, "Largo de arrays no coincide");
    require(dimScores.length == workers.length * 3, "Largo de dimScores no coincide");

    StudioProxy studioProxy = StudioProxy(payable(studio));

    // Calcular pool de recompensas
    uint256 totalEscrow = studioProxy.getTotalEscrow();
    uint256 totalStakes = 0;
    uint256 totalWeight = 0;

    for (uint256 i = 0; i < workers.length; i++) {
        uint256 agentId = studioProxy.getAgentId(workers[i]);
        require(agentId != 0, "Worker no registrado");
        totalStakes += studioProxy.getAgentStake(agentId);
        totalWeight += weights[i];
    }

    require(totalEscrow > totalStakes, "Sin pool de recompensas");
    require(totalWeight > 0, "Peso total es cero");
    uint256 rewardPool = totalEscrow - totalStakes;

    // Distribuir recompensas + devolver stakes
    uint256 totalDistributed = 0;
    bytes32 resolutionHash = keccak256(
        abi.encodePacked(studio, epoch, resolution, block.timestamp)
    );

    for (uint256 i = 0; i < workers.length; i++) {
        uint256 agentId = studioProxy.getAgentId(workers[i]);
        uint256 reward = (rewardPool * weights[i]) / totalWeight;
        uint256 stake = studioProxy.getAgentStake(agentId);

        if (reward > 0) {
            studioProxy.releaseFunds(workers[i], reward, resolutionHash);
            totalDistributed += reward;
        }
        if (stake > 0) {
            studioProxy.releaseFunds(workers[i], stake, resolutionHash);
        }

        // Publicar reputación en 3 dimensiones (sin tag de precisión)
        _publishResolutionReputation(
            agentId,
            dimScores[i * 3],       // Calidad de Resolución
            dimScores[i * 3 + 1],   // Calidad de Fuentes
            dimScores[i * 3 + 2]    // Profundidad de Análisis
        );
    }

    _epochWork[studio][epoch].push(resolutionHash);
    emit ResolutionCompleted(studio, epoch, resolution, totalDistributed, workers.length);
}
```

### 6.2 Contrato: `_publishResolutionReputation` — 3 dimensiones

```solidity
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

    // Dimensión 1: Calidad de Resolución (peso 250 en getScoringCriteria)
    try rep.giveFeedback(
        agentId, int128(uint128(resolutionQuality)), 0,
        "RESOLUTION_QUALITY", "", "", "", bytes32(0)
    ) {} catch {}

    // Dimensión 2: Calidad de Fuentes (peso 200)
    try rep.giveFeedback(
        agentId, int128(uint128(sourceQuality)), 0,
        "SOURCE_QUALITY", "", "", "", bytes32(0)
    ) {} catch {}

    // Dimensión 3: Profundidad de Análisis (peso 150)
    try rep.giveFeedback(
        agentId, int128(uint128(analysisDepth)), 0,
        "ANALYSIS_DEPTH", "", "", "", bytes32(0)
    ) {} catch {}
}
```

### 6.3 Contrato: `_getAgentReputation` — leer reputación compuesta

```solidity
function _getAgentReputation(uint256 agentId) internal view returns (uint256) {
    // Este helper ya NO se usa en resolveAndDistribute (la reputación se lee off-chain por CRE)
    // Se mantiene para consultas externas y como utilidad
    address reputationRegistryAddr = registry.getReputationRegistry();
    if (reputationRegistryAddr == address(0)) return 50;

    uint256 size;
    assembly { size := extcodesize(reputationRegistryAddr) }
    if (size == 0) return 50;

    address[] memory clients = new address[](1);
    clients[0] = address(this);

    try IERC8004Reputation(reputationRegistryAddr).getSummary(
        agentId, clients, "RESOLUTION_QUALITY", ""
    ) returns (uint64 count, int128 summaryValue, uint8) {
        if (count == 0) return 50;      // Sin historial → neutral
        if (summaryValue < 0) return 10; // Reputación negativa → mínimo
        if (summaryValue > 100) return 100; // Tope en 100
        return uint256(uint128(summaryValue));
    } catch {
        return 50; // Fallback → neutral
    }
}
```

### 6.4 Workflow CRE: Paso 5 — computar pesos off-chain

```typescript
// step5-resolve.ts — ahora produce pesos pre-computados
export function resolve(evaluations: WorkerEvaluation[]): ResolutionResult {
  // Voto ponderado mayoritario (sin cambios)
  let pesoSi = 0;
  let pesoNo = 0;
  for (const ev of evaluations) {
    const peso = ev.qualityScore * ev.worker.reputation;
    if (ev.determination) pesoSi += peso;
    else pesoNo += peso;
  }
  const resolution = pesoSi > pesoNo;

  // Pre-computar pesos blindados (NUEVO)
  const MULT_ACERTADO = 200;
  const MULT_ERRADO = 50;

  const workers: string[] = [];
  const weights: number[] = [];         // blindado: calidad × correctitud × rep
  const dimScores: number[] = [];       // plano: [calidadRes, calidadFuentes, análisis] por worker
  const determinations: boolean[] = []; // se queda off-chain, NO se envía al contrato

  for (const ev of evaluations) {
    const multCorrectitud = ev.determination === resolution
      ? MULT_ACERTADO : MULT_ERRADO;

    workers.push(ev.worker.address);
    weights.push(ev.qualityScore * multCorrectitud * ev.worker.reputation);
    determinations.push(ev.determination); // solo off-chain

    // Scores por dimensión (del Paso 4 de evaluación)
    dimScores.push(ev.resolutionQuality ?? ev.qualityScore);
    dimScores.push(ev.sourceQuality ?? Math.round(ev.qualityScore * 0.8));
    dimScores.push(ev.analysisDepth ?? Math.round(ev.qualityScore * 0.7));
  }

  return { resolution, workers, weights, dimScores, determinations };
}
```

### 6.5 CREReceiver: actualizar encoding del reporte

```solidity
// CREReceiver.onReport — decodificación actualizada
(
    address studio,
    uint64 epoch,
    address[] memory workers,
    uint256[] memory weights,
    uint8[] memory dimScores,
    bool resolution
) = abi.decode(report, (address, uint64, address[], uint256[], uint8[], bool));

rewardsDistributor.resolveAndDistribute(
    studio, epoch, workers, weights, dimScores, resolution
);
```

---

## 7. Flujo completo con Opción 4

```
PASO 4 CRE (EVALUAR)                    PASO 5 CRE (RESOLVER)
─────────────────────                    ──────────────────────
Por worker, evalúa 8 dimensiones:        Computa:
 • Iniciativa: 75                         peso = calidadAgregada × multCorrectitud × rep
 • Colaboración: 80                       dimScores = [calidadRes, calidadFuentes, análisis]
 • Profundidad de Razonamiento: 85
 • Cumplimiento: 90                      CONFIDENCIAL:
 • Eficiencia: 70                         determinación = verdadero/falso
 • Calidad de Resolución: 88  ────────►   multCorrectitud = 200/50
 • Calidad de Fuentes: 72      on-chain    qualityScore crudo
 • Profundidad de Análisis: 65 ────────►
                                         PÚBLICO (on-chain):
                                          weights[] (blindados)
                                          dimScores[] (3 dims, sin precisión)
                                          resolution (respuesta final)
```

```
ON-CHAIN (lo que cualquiera puede ver):
────────────────────────────────────────
Worker A: peso=850000, Calidad Resolución=88, Calidad Fuentes=72, Prof. Análisis=65
Worker B: peso=150000, Calidad Resolución=40, Calidad Fuentes=35, Prof. Análisis=30
Resolución: VERDADERO

¿Worker A votó VERDADERO o FALSO? → NO SE PUEDE DETERMINAR con certeza
  - peso alto podría ser: buena calidad + acertó (200x)
  - O podría ser: calidad excelente + erró (50x) + reputación alta
  - La ambigüedad es intencional
```

---

## 8. Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Inferencia estadística de votos por ratio de recompensa | Media | Medio | Con ≥3 workers, múltiples combinaciones producen el mismo ratio |
| CRE computa pesos incorrectamente | Baja | Alto | Consenso multi-DON en CRE; validación de límites de recompensa on-chain |
| Gas de 3 giveFeedback por worker | Baja | Bajo | Para 3 workers = 9 llamadas, factible en L2 (Base Sepolia) |
| Cambio de firma rompe CREReceiver | Cierta | Bajo | Actualizar encoding en CREReceiver y step6-write simultáneamente |
| Observador correlaciona dimScores con precisión | Baja | Medio | dimScores no incluyen multiplicador de correctitud — son evaluaciones puras |

---

## 9. Chainlink Privacy Track — Análisis de aplicabilidad

### Contexto

Chainlink anunció dos nuevas capacidades de privacidad para el hackathon:

1. **Confidential HTTP** (capacidad de CRE): Llamadas HTTP donde las credenciales de API,
   parámetros de request/response, y datos sensibles **nunca tocan la blockchain**. Se ejecutan
   dentro de un TEE (Trusted Execution Environment).

2. **Private Transactions** (Chainlink Confidential Compute, acceso anticipado): Movimientos
   de tokens donde **los montos, las partes, y los detalles de la transacción** son ocultos
   on-chain. Usa TEE + DKG (Distributed Key Generation) + encriptación por umbral.

Referencia: [chain.link/privacy](https://chain.link/privacy) |
[blog.chain.link/chainlink-confidential-compute](https://blog.chain.link/chainlink-confidential-compute/)

### La confusión: "mantener privados los scores de los agentes"

Hay un problema lógico fundamental:

```
Reputación PRIVADA                    Reputación PÚBLICA
     │                                     │
     │  Nadie puede leerla                 │  Cualquiera puede consultarla
     │  → Es INÚTIL                        │  → Tiene VALOR
     │  ¿Para qué publicarla?              │  → Pero es visible
     └─────────────────────────────────────┘
```

Si escribes un score en el Reputation Registry y lo haces "privado", nadie puede consultarlo
con `getSummary()`. Y si nadie puede consultarlo, no sirve de nada. **El punto entero de la
reputación on-chain es que sea legible.**

Incluso si la TRANSACCIÓN de `giveFeedback()` es privada (nadie ve el calldata en el block
explorer), el **cambio de estado** en el contrato sigue siendo público — cualquiera puede
llamar `readAllFeedback()` o `getSummary()` y ver los valores almacenados.

Los scores de dimensión (Resolution Quality=85, Source Quality=72) **DEBEN ser públicos**
para tener valor como reputación.

### Qué SÍ podemos hacer privado (3 capas)

#### Capa 1: Cómputo off-chain (Confidential HTTP) — YA LO TENEMOS

| Dato | Dónde vive | Privado |
|------|-----------|---------|
| Determinación de cada worker (verdadero/falso) | TEE de CRE | SI |
| Evidencia y fuentes recopiladas | TEE de CRE | SI |
| Preguntas y respuestas del challenge | TEE de CRE | SI |
| Scores por las 8 dimensiones crudos | TEE de CRE | SI |
| Cálculo del multiplicador de correctitud | TEE de CRE | SI |
| API keys del LLM | TEE de CRE | SI |

#### Capa 2: Pagos de recompensas (Private Transactions) — NUEVO

| Dato | Sin Private Tx | Con Private Tx |
|------|---------------|----------------|
| Quién recibió reward | PÚBLICO (evento FundsReleased) | **PRIVADO** |
| Cuánto recibió cada worker | PÚBLICO (montos en calldata) | **PRIVADO** |
| Distribución proporcional | PÚBLICO (se puede calcular) | **PRIVADO** |

**Esto es lo que cierra el último vector de ataque.** En Opción 4, dijimos: "si Worker A
recibe 80% del reward y Worker B 20%, un observador puede inferir parcialmente quién acertó."
Con Private Transactions, **esos montos son invisibles**.

#### Capa 3: Reputación on-chain (DEBE ser pública)

| Dato | Privado | Por qué |
|------|---------|---------|
| Resolution Quality=85 por worker | NO | Es el punto entero de la reputación |
| Source Quality=72 por worker | NO | Necesita ser consultable por futuros workflows |
| Analysis Depth=65 por worker | NO | Otros Studios pueden usarla para seleccionar workers |

Esto **está bien** porque los scores por dimensión NO revelan cómo votó el agente
(eso ya lo resolvemos con Opción 4 — sin tag ACCURATE/INACCURATE).

### Modelo completo: Opción 4 + Privacy Track

```
┌──────────────────────────────────────────────────────────────┐
│  CRE TEE (Confidential HTTP + Confidential Compute)         │
│                                                              │
│  SECRETO: votos, evidencia, quality scores crudos,           │
│           multiplicador de correctitud, API keys             │
│                                                              │
│  Produce:                                                    │
│   • weights[] (blindados)                                    │
│   • dimScores[] (3 dimensiones, sin tag de precisión)        │
│   • resolution (respuesta del mercado)                       │
│   • pagos por worker (montos calculados)                     │
└──────────┬───────────────────────────────┬───────────────────┘
           │                               │
    ┌──────▼──────────┐          ┌─────────▼──────────────┐
    │  REPUTACIÓN      │          │  PAGOS                  │
    │  (pública)       │          │  (Private Transactions) │
    │                  │          │                         │
    │  giveFeedback:   │          │  releaseFunds:          │
    │  ResQuality=85   │          │  Worker A: ??? ETH      │
    │  SrcQuality=72   │          │  Worker B: ??? ETH      │
    │  Analysis=65     │          │  (montos ocultos)       │
    │                  │          │                         │
    │  Consultable     │          │  No consultable         │
    │  por cualquiera  │          │  por observadores       │
    └──────────────────┘          └─────────────────────────┘
```

**Lo que un observador externo puede ver**:
- Worker A tiene: Resolution Quality=85, Source Quality=72, Analysis Depth=65
- Worker B tiene: Resolution Quality=40, Source Quality=35, Analysis Depth=30
- Resolución del mercado: VERDADERO

**Lo que NO puede ver**:
- Quién votó verdadero o falso
- Cuánto recibió cada worker de reward
- La evidencia que presentó cada worker
- Los scores crudos antes del blindaje

**Lo que NO puede inferir** (con Private Tx):
- Antes: "A recibió 4x más que B, probablemente acertó" → ya no puede ver los montos
- Los dimScores son evaluaciones de calidad puras, no incorporan correctitud

### Encaje con el Privacy Track del hackathon

ChaosSettler encaja directamente en estos casos de uso listados en la descripción del track:

> **"Private governance payouts & incentives"**: La lógica de scoring corre offchain. Las
> recompensas se distribuyen vía transacciones privadas. Los montos individuales no son
> públicamente visibles.

> **"Private rewards & revenue distribution"**: Cómputo offchain determina las asignaciones.
> Pagos ejecutados vía transacciones privadas. Soporta recompensas, revenue shares, bounties
> e incentivos.

> **"Secure Web2 API integration for decentralized workflows"**: APIs externas usadas en
> CRE sin exponer API keys o parámetros sensibles onchain.

> **"Credential-secure data ingestion and processing"**: Obtener y procesar datos externos
> offchain usando CRE previniendo que los secretos se expongan en la blockchain o logs.

**Conclusión**: Podemos aplicar a **dos tracks simultáneamente**: Prediction Markets + Privacy.

### Resumen: qué protege qué

| Lo que se pensaba | La realidad |
|-------------------|-------------|
| "Podemos hacer los scores privados" | Los scores de reputación DEBEN ser públicos para ser útiles |
| "Privacy = esconder todo on-chain" | Privacy = esconder PAGOS + proteger CÓMPUTO off-chain |
| "No sirve para nuestro caso" | SÍ sirve — Private Tx cierra el vector de inferencia por montos |

La combinación correcta es: **Opción 4** (blindaje de votos en la firma del contrato) +
**Confidential HTTP** (cómputo off-chain protegido) + **Private Transactions** (pagos ocultos).
Cada capa protege algo diferente, y juntas eliminan prácticamente toda posibilidad de inferir
los votos individuales.

### Riesgos y mitigaciones adicionales con Privacy Track

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Private Transactions no disponible a tiempo (disponible desde Feb 16) | Media | Alto | Opción 4 funciona sin Private Tx; los pagos públicos son aceptables como fallback |
| Documentación limitada (solo workshop + gitbook) | Alta | Medio | Asistir al workshop, preguntar en Telegram, implementar flujo básico |
| Incompatibilidad con releaseFunds() de StudioProxy | Media | Alto | Investigar si Private Tx soporta llamadas a contratos arbitrarios o solo transferencias |
| Auditoría / compliance requiere ver pagos | Baja | Bajo | Chainlink Confidential Compute soporta revelación selectiva a auditores designados |
