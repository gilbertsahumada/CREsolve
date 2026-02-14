Plan: Análisis closeEpoch + Guard _epochResolved + Implementación restante

 Análisis: ¿Por qué NO necesitamos closeEpoch() en ChaosSettler?

 El flujo normal de ChaosChain (sin ChaosSettler)

 ChaosChain tiene un ciclo de vida de 5 fases donde cada variable de estado tiene un rol:

 1. submitWork()          → _workSubmissions, _workParticipants, _contributionWeights
 2. registerWork()        → _epochWork[studio][epoch][]  (Gateway lo llama)
 3. submitScore()         → _scoreVectorsPerWorker[hash][validator][worker]
 4. registerValidator()   → _workValidators[hash][]  (Gateway lo llama)
 5. closeEpoch()          → Lee todo lo anterior, calcula consenso MAD, distribuye, publica reputación

 Qué hace closeEpoch() y POR QUÉ cada variable importa en ese flujo

 Variable: _epochWork[studio][epoch]
 Escrita por: registerWork()
 Leída por: closeEpoch() línea 95
 Propósito: Lista de trabajos a evaluar. Sin esto → revert "No work in epoch"
 ────────────────────────────────────────
 Variable: _workValidators[hash]
 Escrita por: registerValidator()
 Leída por: closeEpoch() línea 110
 Propósito: Lista de validadores por trabajo. Sin esto → revert "No validators"
 ────────────────────────────────────────
 Variable: _consensusResults[key]
 Escrita por: closeEpoch() línea 220-227
 Leída por: getConsensusResult() (getter público)
 Propósito: Almacena el consenso calculado (scores, stake, timestamp). Solo leído por tests — ningún código de producción lo consulta
 ────────────────────────────────────────
 Variable: _processedVectors
 Escrita por: NADIE
 Leída por: NADIE
 Propósito: Código muerto. Mapping declarado pero jamás escrito ni leído

 Qué hace closeEpoch() que resolveAndDistribute() NO hace

 ┌───────────────────────────────────────┬────────────────────────────────────────────────┬──────────────────────────────────────────┬─────────────────────────────────────────────────┐
 │                Acción                 │                   closeEpoch                   │           resolveAndDistribute           │          ¿Necesario para ChaosSettler?          │
 ├───────────────────────────────────────┼────────────────────────────────────────────────┼──────────────────────────────────────────┼─────────────────────────────────────────────────┤
 │ Calcular consenso MAD (mediana +      │ SI — usa Scoring.consensus() con scores de     │ NO — CRE pre-computa weights off-chain   │ NO — CRE reemplaza el cálculo MAD               │
 │ outlier detection)                    │ validadores                                    │ en TEE                                   │                                                 │
 ├───────────────────────────────────────┼────────────────────────────────────────────────┼──────────────────────────────────────────┼─────────────────────────────────────────────────┤
 │ Distribuir rewards a workers          │ SI — basado en contributionWeight × quality    │ SI — basado en weights pre-computados    │ SI ✓ (ya lo hacemos)                            │
 ├───────────────────────────────────────┼────────────────────────────────────────────────┼──────────────────────────────────────────┼─────────────────────────────────────────────────┤
 │ Distribuir rewards a validadores      │ SI — basado en error vs consenso               │ NO — no hay validadores                  │ NO — CRE es el evaluador, no necesita pago      │
 ├───────────────────────────────────────┼────────────────────────────────────────────────┼──────────────────────────────────────────┼─────────────────────────────────────────────────┤
 │ Devolver stakes                       │ SI (implícito via releaseFunds)                │ SI (explícito)                           │ SI ✓ (ya lo hacemos)                            │
 ├───────────────────────────────────────┼────────────────────────────────────────────────┼──────────────────────────────────────────┼─────────────────────────────────────────────────┤
 │ Publicar reputación worker (5 dims    │ SI — Initiative, Collaboration, Reasoning,     │ NO                                       │ NO — ver explicación abajo                      │
 │ PoA)                                  │ Compliance, Efficiency                         │                                          │                                                 │
 ├───────────────────────────────────────┼────────────────────────────────────────────────┼──────────────────────────────────────────┼─────────────────────────────────────────────────┤
 │ Publicar reputación worker (3 dims    │ NO                                             │ SI — Resolution Quality, Source Quality, │ SI ✓ (ya lo hacemos)                            │
 │ custom)                               │                                                │  Analysis Depth                          │                                                 │
 ├───────────────────────────────────────┼────────────────────────────────────────────────┼──────────────────────────────────────────┼─────────────────────────────────────────────────┤
 │ Publicar reputación validador         │ SI — VALIDATOR_ACCURACY                        │ NO                                       │ NO — no hay validadores                         │
 ├───────────────────────────────────────┼────────────────────────────────────────────────┼──────────────────────────────────────────┼─────────────────────────────────────────────────┤
 │ Publicar en ValidationRegistry        │ SI                                             │ NO                                       │ NO — write-only para ecosistema ERC-8004        │
 │                                       │                                                │                                          │ externo, ChaosChain no lo lee                   │
 ├───────────────────────────────────────┼────────────────────────────────────────────────┼──────────────────────────────────────────┼─────────────────────────────────────────────────┤
 │ Almacenar _consensusResults           │ SI                                             │ NO                                       │ NO — solo lo leen tests, no código de           │
 │                                       │                                                │                                          │ producción                                      │
 └───────────────────────────────────────┴────────────────────────────────────────────────┴──────────────────────────────────────────┴─────────────────────────────────────────────────┘

 ¿Por qué NO publicamos las 5 dimensiones PoA?

 Las 5 dimensiones PoA (Initiative, Collaboration, Reasoning Depth, Compliance, Efficiency) miden cómo un worker colabora DENTRO de un equipo DKG:

 - Initiative: ¿Propuso ideas? ¿Tomó la iniciativa?
 - Collaboration: ¿Trabajó bien con otros workers?
 - Reasoning Depth: ¿Su razonamiento fue profundo?
 - Compliance: ¿Siguió las reglas del studio?
 - Efficiency: ¿Completó a tiempo?

 Estas métricas requieren que validadores humanos/agentes observen el proceso de trabajo — leen threads de XMTP, analizan contribuciones, y dan scores subjetivos.

 En ChaosSettler:
 - Los workers investigan independientemente (no hay equipo DKG)
 - No hay validadores observando el proceso
 - CRE evalúa el resultado (evidence + challenge), no el proceso
 - Las 3 dimensiones custom (Resolution Quality, Source Quality, Analysis Depth) son lo que CRE puede evaluar objetivamente

 Conclusión: Las 5 PoA no aplican conceptualmente. No es que "falten" — es que miden algo que no existe en nuestro flujo.

 ¿Y la reputación publicada? ¿Quién la usa después?

 1. _getReputation() (RewardsDistributor línea 1277) — consulta RESOLUTION_QUALITY del ReputationRegistry
   - CRE la usa off-chain para computar weights en futuras resoluciones
   - Pero en resolveAndDistribute() no se llama — CRE ya pre-computó los weights
   - Es utility para uso futuro (siguiente epoch)
 2. Ecosistema ERC-8004 externo — otros servicios pueden consultar la reputación
   - Dashboards, filtros de workers, etc.
   - Nuestras 3 dimensiones SÍ se publican, así que la reputación del worker crece

 Estado "sucio" que queda — ¿importa?

 ┌───────────────────────────────────────┬────────────────────────────────────────────────────────┬───────────────────────────────────────────────────────────────────┐
 │                Estado                 │                       Queda como                       │                            ¿Problema?                             │
 ├───────────────────────────────────────┼────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────┤
 │ _consensusResults vacío               │ Nunca se populó                                        │ NO — getter retorna struct vacío (timestamp=0), nadie lo consulta │
 ├───────────────────────────────────────┼────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────┤
 │ _workValidators vacío                 │ Nunca se registraron validadores                       │ NO — solo lo lee closeEpoch() que no llamamos                     │
 ├───────────────────────────────────────┼────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────┤
 │ _agentStakes[agentId] no decrementado │ releaseFunds() solo toca _totalEscrow, no _agentStakes │ RIESGO si se llama dos veces (ver Bug abajo)                      │
 ├───────────────────────────────────────┼────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────┤
 │ _processedVectors                     │ Código muerto                                          │ NO — nadie lo lee ni escribe                                      │
 └───────────────────────────────────────┴────────────────────────────────────────────────────────┴───────────────────────────────────────────────────────────────────┘

 ---
 Bug encontrado: Double-call en resolveAndDistribute()

 Problema

 resolveAndDistribute() no tiene guard contra double-call. Si se llama dos veces para el mismo studio + epoch:

 1. Primera llamada: distribuye rewards + devuelve stakes → _totalEscrow baja ✓
 2. getAgentStake(agentId) sigue retornando el valor original (no se decrementó)
 3. Segunda llamada: intenta devolver stakes otra vez
 4. Si quedan fondos → workers cobran doble. Si no → revert "Insufficient escrow"

 Solución: 3 líneas

 // Nuevo estado
 mapping(address => mapping(uint64 => bool)) private _epochResolved;

 // Al inicio de resolveAndDistribute():
 require(!_epochResolved[studio][epoch], "Already resolved");

 // Al final de resolveAndDistribute():
 _epochResolved[studio][epoch] = true;

 Esto también previene que alguien llame closeEpoch() + resolveAndDistribute() en el mismo epoch (mutuamente excluyentes).

 Archivos a modificar

 - packages/contracts/src/RewardsDistributor.sol — agregar mapping + 2 requires
 - hackathon/IMPLEMENTATION_GUIDE.md — actualizar §A4 con el guard

 Verificación

 - forge build → compila sin errores
 - forge test → 58 tests existentes siguen pasando
 - Nuevo test test_reverts_double_resolution() verifica que la segunda llamada revierte

 ---
 Implementación restante (post-guard)

 Fase 1: Contratos (rama hackathon/chaos-settler)

 Paso 1 → Agregar _epochResolved guard a RewardsDistributor.sol (~3 líneas)

 Paso 2 → packages/contracts/src/CREReceiver.sol (~65 líneas)
 - Puente KeystoneForwarder → resolveAndDistribute
 - Import: @openzeppelin/access/Ownable.sol (sin /contracts/)
 - Código en IMPLEMENTATION_GUIDE.md §C

 Paso 3 → packages/contracts/test/ResolveAndDistribute.t.sol (~200 líneas)
 - Tests para resolveAndDistribute Option 4 + test double-call revert
 - Código en IMPLEMENTATION_GUIDE.md §E

 Paso 4 → packages/contracts/test/CREReceiver.t.sol (~120 líneas)
 - Código en IMPLEMENTATION_GUIDE.md §D

 Paso 5 → packages/contracts/test/ResolutionMarketLogic.t.sol (~100 líneas)

 Paso 6 → Validar: forge build && forge test

 Paso 7 → packages/contracts/script/DeployChaosSettler.s.sol (~100 líneas)

 Paso 8 → Commit Fase 1

 Fase 2: Repo chaossettler/ (nuevo)

 Paso 9 → Worker Agent (Python/FastAPI, ~310 líneas)
 Paso 10 → CRE Workflow (TypeScript, ~420 líneas)
 Paso 11 → Scripts setup/demo (TypeScript, ~340 líneas)

 Fase 3: Integración

 Paso 12 → E2E local (Anvil port 8546)
 Paso 13 → Demo 3 mercados

 ---
 Archivos críticos

 ┌────────────────────────────────────────┬──────────────────────────────────────────────────────────────────┐
 │               Referencia               │                               Path                               │
 ├────────────────────────────────────────┼──────────────────────────────────────────────────────────────────┤
 │ IMPLEMENTATION_GUIDE (código completo) │ hackathon/IMPLEMENTATION_GUIDE.md                                │
 ├────────────────────────────────────────┼──────────────────────────────────────────────────────────────────┤
 │ RewardsDistributor (modificar)         │ packages/contracts/src/RewardsDistributor.sol                    │
 ├────────────────────────────────────────┼──────────────────────────────────────────────────────────────────┤
 │ ResolutionMarketLogic (ya listo)       │ packages/contracts/src/logic/ResolutionMarketLogic.sol           │
 ├────────────────────────────────────────┼──────────────────────────────────────────────────────────────────┤
 │ CloseEpoch tests (patrón mocks)        │ packages/contracts/test/integration/CloseEpoch.integration.t.sol │
 ├────────────────────────────────────────┼──────────────────────────────────────────────────────────────────┤
 │ DeployCore (patrón deploy)             │ packages/contracts/script/DeployCore.s.sol                       │
 ├────────────────────────────────────────┼──────────────────────────────────────────────────────────────────┤
 │ StudioProxy (releaseFunds ref)         │ packages/contracts/src/StudioProxy.sol                           │
 └────────────────────────────────────────┴──────────────────────────────────────────────────────────────────┘

 Verificación

 - forge build --skip script test → compila
 - forge test → todos pasan (existentes + nuevos)
 - Test específico: forge test --match-test test_reverts_double_resolution -vvv