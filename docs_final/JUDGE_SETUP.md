# CREsolver — Judge Setup & Verification

Guía corta para revisar el flujo sin fricción.

## 1) Flujo recomendado (local, determinístico)

Precondiciones:
- Docker corriendo.
- Dependencias instaladas en `agent/`, `scripts/`, `e2e/`.

Comandos:
```bash
yarn e2e:up
yarn e2e:setup
yarn e2e:test
yarn e2e:down
```

Qué validar:
- `e2e:setup` despliega contrato, crea 3 mercados y registra 3 workers.
- `e2e:test` pasa en verde (salud de agentes, resolución de mercados, path receiver).

## 2) Setup de agentes Sepolia (si quieren revisar wallets/identidad)

Generar wallets:
```bash
yarn sepolia:wallets
```

Registrar agentes ERC-8004:
```bash
yarn sepolia:sync
```

Normalizar agentes ya existentes (sin re-registrar IDs):
```bash
yarn sepolia:normalize
```

Verificar consistencia y autorización:
```bash
yarn sepolia:verify
```

Auditoría estricta on-chain (owner, wallet, tokenURI registration-v1, balances):
```bash
yarn sepolia:audit --min-eth 0.01
```

Exportar archivo público sin private keys:
```bash
yarn sepolia:verify --public-out sepolia-agents.public.json
```

Notas:
- `scripts/sepolia-agents.json` contiene private keys (archivo privado).
- `sepolia-agents.public.json` deja solo `name`, `address`, `agentId`.

## 3) Verificaciones mínimas esperadas

- Cada `privateKey` corresponde a su `address`.
- Cada worker tiene balance suficiente para operar.
- Cada worker autorizado en IdentityRegistry para su `agentId` (`isAuthorizedOrOwner=true`).

## 4) Deploy Sepolia de referencia

```bash
yarn sepolia:deploy
```

Salida esperada:
- contrato `CREsolverMarket` desplegado;
- mercado de prueba creado;
- 3 workers hacen `joinMarket` con `agentId`.
