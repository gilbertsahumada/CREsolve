# CREsolver Privacy Roadmap (HTTP First, Transactions Later)

Documento de diseño para incorporar privacidad en CREsolver en dos fases:

1. **Fase 1 (inmediata): Confidential HTTP + secrets en CRE TEE**
2. **Fase 2 (posterior): rewards/transacciones con mayor privacidad**

Fecha: 2026-02-20

---

## 1) Objetivo y Alcance

Objetivo principal:
- Reducir exposición de datos sensibles durante la resolución de mercados (API keys, headers de autenticación, payloads de llamadas externas).

Objetivo secundario:
- Evaluar privacidad de rewards sin romper la simplicidad operativa para hackathon.

Fuera de alcance de Fase 1:
- Privacidad fuerte de montos on-chain.
- Reemplazo completo del settlement on-chain actual.

---

## 2) Análisis de Repositorios de Referencia

### 2.1 `conf-http-demo` (Chainlink)

Repo:
- https://github.com/smartcontractkit/conf-http-demo

Qué implementa técnicamente:
- `ConfidentialHTTPClient` dentro de CRE.
- `vaultDonSecrets` para resolver secretos sin incluir API keys en config/código.
- Templates de headers con placeholders (ej: `{{.myApiKey}}`).
- `encryptOutput: true` para cifrar respuesta dentro del enclave.

Archivos clave revisados:
- `README.md`: explica secrets, cifrado, flujo de simulación.
- `my-workflow/main.ts`: patrón real de `ConfidentialHTTPClient`, `vaultDonSecrets`, `encryptOutput`.
- `secrets.yaml`: mapeo de claves de vault a variables de entorno para simulación.
- `my-workflow/workflow.yaml`: wiring de config + secrets-path.

Conclusión:
- Es el patrón correcto para nuestra **Fase 1**.
- Aplica directo a nuestras llamadas `/a2a/resolve` y `/a2a/challenge`.

### 2.2 `Compliant-Private-Transfer-Demo` (Chainlink)

Repo:
- https://github.com/smartcontractkit/Compliant-Private-Transfer-Demo

Qué implementa técnicamente:
- Arquitectura híbrida:
  - On-chain: ERC20 + Vault + PolicyEngine (ACE).
  - Off-chain: API de balances privados, transferencias privadas, shielded address, tickets de retiro.
- Autenticación fuerte de API con firmas EIP-712 por endpoint.
- `private-transfer` validado contra compliance on-chain usando `checkPrivateTransferAllowed()` (via `eth_call`).
- Retiro en dos pasos:
  1. API emite `ticket` y descuenta balance privado.
  2. Usuario redime on-chain con `withdrawWithTicket(token, amount, ticket)`.

Archivos clave revisados:
- `README.md`: flujo completo de setup, private transfer, shielded addresses, withdraw tickets.
- `script/SetupAll.s.sol`, `05_RegisterVault.s.sol`, `06_DepositToVault.s.sol`, `07_WithdrawWithTicket.s.sol`.
- `src/SimpleToken.sol`.
- `api-scripts/src/common.ts`: dominio EIP-712 y firma.
- `api-scripts/src/private-transfer.ts`, `withdraw.ts`, `balances.ts`, `shielded-address.ts`, `transactions.ts`.
- Docs live: https://convergence2026-token-api.cldev.cloud/docs

Conclusión:
- No es "privacidad mágica on-chain"; es privacidad operativa con ledger/API off-chain + ticketing.
- Es útil como referencia de **Fase 2** si queremos ese modelo.

---

## 3) Estado Actual de CREsolver (baseline)

En el código actual:
- Settlement on-chain directo en `CREsolverMarket`:
  - `resolveMarket(...)` distribuye `rewardPool` por `weights[]` y acumula en `balances[worker]`.
  - `withdraw()` transfiere ETH al worker.
- Workflow usa `HTTPClient` estándar para agentes:
  - `POST /a2a/resolve`
  - `POST /a2a/challenge`
- Agentes Hono no exigen auth header hoy.

Implicación:
- Rewards y retiros son transparentes on-chain.
- Las llamadas HTTP no están usando modo confidencial de CRE todavía.

---

## 4) Decisión Recomendada

### 4.1 Para hackathon (ahora)

Implementar solo:
- **Confidential HTTP + secrets en TEE** para llamadas a agentes.

Razón:
- Alto impacto de seguridad.
- Bajo riesgo de integración.
- Mantiene `yarn e2e` simple.

### 4.2 Para fase posterior

Evaluar privacidad de payouts como iniciativa separada:
- No mezclarla con estabilización de demo/hackathon.

---

## 5) Fase 1 Diseño (Confidential HTTP + Secrets)

### 5.1 Cambios de arquitectura

- Workflow CRE cambia de `HTTPClient` a `ConfidentialHTTPClient` para llamadas a agentes.
- Cada request a `/a2a/*` usa header de auth inyectado vía vault secret.
- El agent valida header opcional (`X-Agent-Token` o `Authorization`).
- Mantener fallback no confidencial para local/E2E rápido.

### 5.2 Cambios propuestos por archivo

### `cre-workflow/cresolver-resolution/types.ts`

Agregar configuración de privacidad:

- `privacy.mode`: `"standard"` | `"confidential_http"`
- `privacy.vault_namespace`: string (ej. `"main"`)
- `privacy.vault_owner`: string opcional
- `privacy.agent_auth_secret_key`: string (ej. `"agentApiToken"`)
- `privacy.encrypt_output`: boolean (default `false`)
- `privacy.auth_header_name`: string (default `"X-Agent-Token"`)

### `cre-workflow/cresolver-resolution/config.json`

Agregar bloque `privacy` de ejemplo.

### `cre-workflow/secrets.yaml`

Agregar mapping para secreto de auth de agentes:
- `agentApiToken` -> `AGENT_API_TOKEN_ALL` (o naming equivalente).

### `cre-workflow/cresolver-resolution/agents.ts`

Refactor:
- helper `sendAgentRequest(...)` que elige según `privacy.mode`:
  - `standard`: path actual con `HTTPClient`.
  - `confidential_http`: usa `ConfidentialHTTPClient` + `vaultDonSecrets`.
- Para modo confidencial:
  - enviar `multiHeaders` con token desde template secret.
  - mantener `consensusIdenticalAggregation` usando `runtime.runInNodeMode`.
- `encryptOutput`:
  - `false` para parseo JSON directo en esta fase.
  - dejar hook para activarlo en flujo futuro de consumidor cifrado.

### `agent/src/config.ts`

Agregar:
- `agentAuthToken` opcional (`AGENT_AUTH_TOKEN`).

### `agent/src/routes/a2a.ts`

Agregar middleware simple:
- Si `agentAuthToken` está definido:
  - exigir header configurado (`X-Agent-Token` recomendado).
  - si falta/inválido -> `401`.
- Si no está definido:
  - comportamiento actual (compatibilidad local).

### `docker-compose.e2e.yml`

Para mantener E2E simple:
- No activar auth por defecto.
- Opcional: profile/override para auth cuando se quiera validar flujo confidencial.

### 5.3 Compatibilidad SDK

`@chainlink/cre-sdk` ya incluye capacidad confidential HTTP en los tipos generados.
Antes de implementar:
- validar API exacta de `ConfidentialHTTPClient` en versión fija del proyecto.
- si hay divergencia de firma, fijar versión compatible y documentarla.

### 5.4 Criterios de aceptación Fase 1

- El workflow resuelve mercados en modo `standard` sin regresiones.
- En modo `confidential_http`, agentes responden correctamente con auth secreta.
- Sin secretos hardcodeados en config/código.
- E2E base (`yarn e2e`) sigue verde.

---

## 6) Fase 1 Testing Plan (simple para jueves)

### 6.1 Unit tests agent

Archivo sugerido: `agent/tests/agent.test.ts`

Casos:
- `AGENT_AUTH_TOKEN` no configurado -> `/a2a/*` funciona como hoy.
- `AGENT_AUTH_TOKEN` configurado + header faltante -> `401`.
- `AGENT_AUTH_TOKEN` configurado + header inválido -> `401`.
- `AGENT_AUTH_TOKEN` configurado + header válido -> `200`.

### 6.2 Workflow smoke (confidential mode)

Agregar script smoke para CRE simulate (no reemplaza e2e actual):
- objetivo: probar confidential HTTP end-to-end del workflow CRE.
- valida:
  - resolve/challenge ok con secreto correcto.
  - falla controlada con secreto incorrecto.

### 6.3 Regression suite

Mantener:
- `yarn e2e` (18 tests).
- typecheck de `cre-workflow`, `scripts`, `e2e`, `agent`.

---

## 7) Fase 2 Diseño (Rewards/Transactions Privacy)

Objetivo:
- Reducir visibilidad de rewards individuales.

Importante:
- En una L1 pública, montos transferidos on-chain son observables en la transacción/eventos.
- Por eso, para "privacidad fuerte" se requiere arquitectura adicional (off-chain ledger, privacidad L2, o criptografía adicional).

### 7.1 Opción A: Modelo tipo ACE Demo (off-chain ledger + tickets)

Inspiración:
- `Compliant-Private-Transfer-Demo`.

Diseño:
- Convertir rewards a token (ERC20) y usar vault.
- Workflow publica asignaciones a servicio off-chain.
- Worker consulta balance privado y pide ticket.
- Worker redime ticket on-chain.

Pros:
- Muy buena privacidad operativa entre asignación y retiro.
- Se puede añadir compliance/reglas.

Contras:
- Complejidad alta (API, indexer, firma, expiración de ticket, operación de servicio).
- Más superficie de fallo y trust assumptions.
- El retiro final on-chain sigue siendo visible (monto/dirección en la transacción de redeem).

### 7.2 Opción B: Claims por compromiso (Merkle) en contrato actual

Diseño:
- `resolveMarket` publica solo `claimsRoot`.
- Cada worker hace `claim(amount, proof, nullifier)` para cobrar.

Pros:
- Menos dependencia off-chain que opción A.
- Contrato más autocontenido.

Contras:
- El monto sigue visible en tx de claim.
- Privacidad parcial, no fuerte.

### 7.3 Recomendación para CREsolver

- Corto plazo: **no** implementar Fase 2 antes del hackathon.
- Post-hackathon:
  - si la meta es "compliance + privacidad operativa": Opción A.
  - si la meta es "mínimo cambio de arquitectura": Opción B.

---

## 8) Feedback Público + Reward Privado: ¿se puede?

Sí, se puede separar:
- Público: `resolution`, `dimScores`, feedback reputacional.
- Más privado: mecanismo de payout (ticket/claims).

Tradeoff:
- Feedback público puede permitir inferencias indirectas de desempeño.
- Si se requiere privacidad alta, se necesita revisar también granularidad de feedback.

---

## 9) Plan de Ejecución Propuesto

### Sprint 1 (ahora): Confidential HTTP

1. Extender config/schema y secrets.
2. Implementar `confidential_http` en workflow.
3. Agregar auth opcional en agents.
4. Mantener modo `standard` para e2e actual.
5. Agregar smoke de confidential mode.

### Sprint 2 (después): rewards privacy (decisión de arquitectura)

1. Elegir Opción A u Opción B.
2. Diseñar contrato y threat model.
3. Implementar PoC.
4. Definir pruebas de seguridad y operativas.

---

## 10) Riesgos y Mitigaciones

Riesgos Fase 1:
- Drift de API SDK confidential.
- Error de configuración de secrets.
- Break de compatibilidad local.

Mitigaciones:
- Feature flag (`privacy.mode`).
- Fallback `standard`.
- Smoke test dedicado en CI/local.

Riesgos Fase 2:
- Complejidad operativa y trust model (si off-chain ledger).
- Falsa expectativa de privacidad "total" en L1.

Mitigaciones:
- Definir explícitamente modelo de privacidad por capa.
- Prototipo aislado antes de migrar settlement principal.

---

## 11) Referencias

- `conf-http-demo`:
  - https://github.com/smartcontractkit/conf-http-demo
  - https://raw.githubusercontent.com/smartcontractkit/conf-http-demo/main/README.md
  - https://raw.githubusercontent.com/smartcontractkit/conf-http-demo/main/my-workflow/main.ts
- `Compliant-Private-Transfer-Demo`:
  - https://github.com/smartcontractkit/Compliant-Private-Transfer-Demo
  - https://raw.githubusercontent.com/smartcontractkit/Compliant-Private-Transfer-Demo/main/README.md
  - https://convergence2026-token-api.cldev.cloud/docs
