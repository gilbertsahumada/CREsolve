# CREsolver — Hackathon One Pager

Documento corto para demo, jurado y ejecución del jueves.

## 1) Qué es CREsolver

CREsolver resuelve mercados de predicción con:
- workers IA (agents) que investigan y responden;
- un workflow de Chainlink CRE que orquesta evaluación y consenso;
- settlement on-chain en `CREsolverMarket`.

Resultado: resolución final + distribución de rewards + reputación por worker.

## 2) Arquitectura mínima (fuente de verdad)

- `contracts/src/CREsolverMarket.sol`: mercado, stake, rewards, reputación.
- `contracts/src/CREReceiver.sol`: puente KeystoneForwarder -> `resolveMarket`.
- `cre-workflow/cresolver-resolution/main.ts`: pipeline READ -> ASK -> CHALLENGE -> EVALUATE -> RESOLVE -> WRITE.
- `cre-workflow/cresolver-resolution/evaluate.ts`: algoritmo canónico de scoring.
- `agent/src/routes/a2a.ts`: endpoints `POST /a2a/resolve` y `POST /a2a/challenge`.
- `scripts/setup-demo.ts`: setup compartido (`--profile local|e2e`).
- `e2e/e2e.test.ts`: suite E2E (18 tests).

## 3) Flujo agéntico end-to-end

1. Se crea mercado y workers hacen `joinMarket`.
2. Se emite `requestResolution(marketId)`.
3. Workflow CRE lee mercado/workers/reputación.
4. Workflow consulta a cada worker (`/a2a/resolve`).
5. Workflow desafía respuestas (`/a2a/challenge`).
6. Workflow evalúa calidad por worker y calcula consenso ponderado.
7. Workflow reporta (`runtime.report`) -> forwarder -> receiver.
8. `resolveMarket` distribuye rewards, devuelve stake y actualiza reputación.

## 4) A2A vs Hono (decisión para hackathon)

- Estado actual: interfaz HTTP simple sobre Hono con contrato JSON estable.
- Para el hackathon, esto es suficiente y reduce riesgo operativo.
- Posición recomendada: presentarlo como "A2A-lite" (protocolo de interacción agéntica desacoplado por endpoint y payload tipado).
- Post-hackathon: si conviene, envolver estos mismos payloads en un envelope A2A formal sin romper lógica de negocio.

## 5) CRE + TEE: HTTP confidencial y secrets

- En CRE, las llamadas HTTP pueden ejecutarse dentro del TEE con secrets del DON vault (sin exponer API keys en código/config pública).
- También puede cifrarse la salida antes de salir del enclave (`encryptOutput`), para que el consumidor descifre fuera del workflow.
- Esto complementa el diseño de CREsolver: lógica pública + datos sensibles protegidos en runtime.

Referencias de Chainlink:
- `conf-http-demo`: confidential HTTP con secrets y respuesta cifrada (`https://github.com/smartcontractkit/conf-http-demo`).
- `Compliant-Private-Transfer-Demo`: patrón de transferencias privadas con controles de permissioning/compliance (`https://github.com/smartcontractkit/Compliant-Private-Transfer-Demo`).

## 6) Algoritmo público (repo abierto)

Implementado en `cre-workflow/cresolver-resolution/evaluate.ts`.

```txt
qualityScore = resolutionQuality * 0.4 + sourceQuality * 0.3 + analysisDepth * 0.3
repFactor = ((resRep + srcRep + depthRep)/3)/100 + 0.5   (si count > 0; si no, 1.0)
voteWeight = qualityScore * repFactor
resolution = sum(voteWeight YES) >= sum(voteWeight NO)
weight = qualityScore * correctnessMult * repFactor
correctnessMult = 200 si acierta, 50 si falla
```

Público:
- algoritmo, factores y dimensiones;
- `weights[]`, `dimScores[]`, `resolution` on-chain.

Confidencial solo si corre en CRE TEE:
- determinaciones individuales, evidencia/challenges, `correctnessMult` en runtime.

## 7) Checklist E2E de jueves (simple)

Precondiciones:
- Docker corriendo.
- Dependencias instaladas.

Ejecución:
```bash
yarn e2e:up
yarn e2e:setup
yarn e2e:test
yarn e2e:down
```

Debe pasar:
- 3 agents sanos (`/health`).
- setup completo (deploy + 3 mercados + join workers + requestResolution).
- 3 resoluciones completas (mercados mock: bitcoin, ethereum, etf).
- reputación acumulada correctamente.
- flujo por receiver validado.
- suite E2E en verde (`18` tests).

## 8) Gate de calidad para demo

Antes de presentar:
```bash
cd contracts && forge test -vvv
cd ../agent && yarn test
cd ../scripts && npx tsc --noEmit
cd ../e2e && npx tsc --noEmit
cd ../cre-workflow/cresolver-resolution && npx tsc --noEmit
cd ../.. && yarn e2e
```

## 9) Mensaje para jurado (30s)

"El algoritmo de evaluación es público y auditable en el repo. Los agents investigan y se desafían entre sí. El workflow de CRE calcula consenso ponderado y liquida on-chain. En entorno TEE protegemos datos sensibles de runtime, sin ocultar la lógica de scoring."
