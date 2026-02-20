# CREsolver — Plan de Ejecución (Hackathon)

Estado: activo  
Objetivo: dejar el flujo completo simple, verificable y demostrable para jurado.

## 1. Alcance y estrategia

Se ejecutará en fases. Primero Opción A (bajo riesgo, rápida), luego hardening.

### Opción A (inmediata)
- Alinear contrato con workflow/scripts/e2e.
- Restaurar reputación interna on-chain (`getReputation`) para mantener compatibilidad.
- Corregir ABI inconsistentes en tests E2E.
- Dejar checklist de verificación simple para jueves.

### Opción B (después de A)
- Hardening de `resolveMarket` (workers duplicados, totalWeight=0, cobertura total de participantes).
- Mejor trazabilidad de estados del mercado.

### Opción C (post-hackathon)
- Privacidad avanzada (Confidential HTTP y luego transacciones privadas).

## 2. Plan por fases

## Fase 0: Baseline y alineación documental
- Revisar contrato, scripts, e2e y workflow CRE.
- Confirmar discrepancias ABI/API y corregir documentación desalineada.

Criterio de salida:
- Matriz de alineación contrato <-> workflow <-> tests documentada.

## Fase 1: Opción A técnica (contract + e2e)
- Contrato:
  - agregar reputación interna acumulada;
  - exponer `getReputation(worker)` con promedio + contador.
- E2E:
  - corregir firma `joinMarket(marketId, agentId)` en test receiver.

Criterio de salida:
- Typecheck en verde (`scripts`, `e2e`, `cre-workflow`).
- Tests Foundry en verde (`forge test --offline`).

## Fase 2: Setup inicial y verificación para jurado
- Estandarizar flujo mínimo:
  1. levantar stack;
  2. setup;
  3. correr e2e;
  4. validar outputs esperados.
- Documentar comandos exactos y qué validar visualmente.

Criterio de salida:
- Un documento único de ejecución para jueves (sin pasos ambiguos).

## Fase 3: Hardening (Opción B)
- Agregar validaciones defensivas en contrato.
- Aumentar cobertura de edge cases.

Criterio de salida:
- Edge tests críticos en verde.

## 3. Checklist de jueves (simple)

Precondiciones:
- Docker activo.
- Dependencias instaladas (`agent`, `scripts`, `e2e`, `contracts`).

Ejecución:
1. `yarn e2e:up`
2. `yarn e2e:setup`
3. `yarn e2e:test`
4. `yarn e2e:down`

Validaciones mínimas:
- 3 agentes `healthy`.
- setup crea 3 mercados y workers hacen join.
- mercados se resuelven y quedan `resolved=true`.
- receiver path probado.

## 4. Riesgos y mitigación (actual)

- Riesgo: ABI desalineada entre contrato y tests/scripts.  
  Mitigación: API on-chain estable + typecheck + smoke tests.

- Riesgo: lógica duplicada en runners (scripts/e2e/workflow).  
  Mitigación: consolidar núcleo en fase posterior (fuera de Opción A).

- Riesgo: cambios tardíos antes de demo.  
  Mitigación: congelar API tras Opción A y mover mejoras no críticas a Opción B.

## 5. Orden de ejecución recomendado

1. Completar Opción A y congelar interfaces.
2. Correr gate técnico (typecheck + forge offline + e2e completo).
3. Preparar demo/jurado con checklist corto.
4. Si hay tiempo, avanzar Opción B.
