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
DEPLOYER_KEY=0x... SEPOLIA_RPC=https://... yarn sepolia:register
```

Verificar consistencia y autorización:
```bash
SEPOLIA_RPC=https://... yarn sepolia:verify
```

Exportar archivo público sin private keys:
```bash
SEPOLIA_RPC=https://... yarn sepolia:verify --public-out sepolia-agents.public.json
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
cd contracts
DEPLOYER_KEY=0x... forge script script/DeploySepolia.s.sol --rpc-url $SEPOLIA_RPC --broadcast -vvvv
```

Salida esperada:
- contrato `CREsolverMarket` desplegado;
- mercado de prueba creado;
- 3 workers hacen `joinMarket` con `agentId`.
