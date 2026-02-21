# EIP-712 Deep Dive (Aplicado a CREsolver + ERC-8004)

Este documento explica EIP-712 desde cero y cómo lo usamos en este proyecto para `setAgentWallet` del IdentityRegistry ERC-8004.

## 1) Qué es EIP-712

EIP-712 es un estándar para firmar **datos estructurados tipados** fuera de la cadena.

Objetivo:
- evitar firmas ambiguas (strings sueltos difíciles de auditar),
- hacer legible lo que el usuario firma,
- prevenir replay entre contratos/redes distintas usando dominio.

En vez de firmar texto libre, se firma una estructura con campos y tipos fijos:
- ejemplo: `agentId`, `newWallet`, `owner`, `deadline`.

## 2) Por qué se usa

Casos típicos:
- permisos delegados (`permit` en ERC-20),
- órdenes off-chain (DEX),
- meta-transactions,
- vinculación de wallets/identidad (nuestro caso con ERC-8004).

Beneficio clave:
- el wallet muestra campos concretos y el usuario entiende qué autoriza.

## 3) Componentes criptográficos (resumen)

EIP-712 firma este digest:
1. `domainSeparator`: identifica contexto (nombre, versión, chainId, contrato).
2. `structHash`: hash de la estructura tipada.
3. digest final: `keccak256("\x19\x01" || domainSeparator || structHash)`.

Si cambias red o contrato, cambia `domainSeparator` y la firma deja de validar.

## 4) Dominio EIP-712

Campos más comunes:
- `name`
- `version`
- `chainId`
- `verifyingContract`

En ERC-8004 IdentityRegistry (implementación usada):
- `name`: `ERC8004IdentityRegistry`
- `version`: `1`
- `chainId`: red actual (Sepolia = `11155111`)
- `verifyingContract`: dirección del IdentityRegistry

## 5) Caso CREsolver: `setAgentWallet`

Flujo funcional:
1. El owner del agente (deployer) quiere asociar `agentId` con wallet worker.
2. El worker firma un payload EIP-712 que prueba control de `newWallet`.
3. El owner envía `setAgentWallet(agentId, newWallet, deadline, signature)`.
4. El contrato verifica firma y aplica `agentWallet`.

Estructura tipada usada:

```text
AgentWalletSet(
  uint256 agentId,
  address newWallet,
  address owner,
  uint256 deadline
)
```

Notas importantes:
- la firma la hace `newWallet` (worker),
- `owner` queda embebido en el payload firmado,
- `deadline` limita ventana temporal (en esta implementación no puede exceder +5 min del bloque).

## 6) Ejemplo real de typed data (JSON)

```json
{
  "domain": {
    "name": "ERC8004IdentityRegistry",
    "version": "1",
    "chainId": 11155111,
    "verifyingContract": "0x8004A818BFB912233c491871b3d84c89A494BD9e"
  },
  "types": {
    "AgentWalletSet": [
      { "name": "agentId", "type": "uint256" },
      { "name": "newWallet", "type": "address" },
      { "name": "owner", "type": "address" },
      { "name": "deadline", "type": "uint256" }
    ]
  },
  "primaryType": "AgentWalletSet",
  "message": {
    "agentId": 1299,
    "newWallet": "0x39dA71D28d9C33676f9B5f0d7e54c34B3B1BE77A",
    "owner": "0x5ee75a1B1648C023e885E58bD3735Ae273f2cc52",
    "deadline": 1730000000
  }
}
```

## 7) Ejemplo de firma en ethers v6

```ts
import { Wallet } from "ethers";

const worker = new Wallet(workerPrivateKey);

const domain = {
  name: "ERC8004IdentityRegistry",
  version: "1",
  chainId: 11155111n,
  verifyingContract: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
};

const types = {
  AgentWalletSet: [
    { name: "agentId", type: "uint256" },
    { name: "newWallet", type: "address" },
    { name: "owner", type: "address" },
    { name: "deadline", type: "uint256" },
  ],
};

const value = {
  agentId: 1299n,
  newWallet: worker.address,
  owner: deployerAddress,
  deadline,
};

const signature = await worker.signTypedData(domain, types, value);
```

Luego el owner llama:

```ts
await identity.setAgentWallet(agentId, worker.address, deadline, signature);
```

## 8) Diferencia contra `personal_sign` / `eth_sign`

Con `personal_sign`:
- firmas bytes/string opaco,
- UX pobre (difícil auditar),
- mayor riesgo de firmar algo malicioso.

Con EIP-712:
- payload tipado y mostrado por campo,
- separación por dominio (red + contrato),
- menos superficie de replay cross-context.

## 9) ERC-1271 (smart wallets)

Si `newWallet` es smart account, no hay ECDSA tradicional de EOA.
En ese caso, el contrato puede validar vía ERC-1271 (`isValidSignature`).

Implicación:
- EIP-712 sigue igual conceptualmente,
- cambia el método de validación de firma.

## 10) Riesgos frecuentes y cómo evitarlos

1. `chainId` incorrecto:
- la firma falla aunque todo lo demás esté bien.

2. `verifyingContract` incorrecto:
- firma inválida por dominio.

3. tipo/campos fuera de orden:
- hash distinto, firma inválida.

4. `deadline` expirado o muy lejano:
- revert en contrato.

5. usar `number` JS para valores grandes:
- usar `bigint` para `uint256`.

6. no alinear metadata con estado on-chain:
- en este repo debemos alinear:
  - `getAgentWallet(agentId)`,
  - servicio `wallet` dentro del `agentURI` registration-v1.

## 11) Cómo lo resolvemos en este repo

Script canónico:
- `scripts/sync-agents.ts`

Qué asegura:
1. registra IDs faltantes (modo `full`),
2. actualiza `agentURI` registration-v1,
3. hace `setAgentWallet` con firma EIP-712 del worker,
4. aprueba worker en ERC-721 (`approve`),
5. verifica consistencia final (`owner`, `isAuthorizedOrOwner`, `agentWallet`, wallet service en URI).

Comandos:

```bash
# registro + normalización completa (si faltan IDs)
yarn sepolia:sync

# normalización de agentes ya existentes (sin re-register)
yarn sepolia:normalize
```

## 12) Resumen práctico

EIP-712 aquí no es opcional decorativo:
- es la prueba criptográfica de que la wallet worker realmente controla el `agentWallet` que se declara.
- permite separar ownership del NFT (owner/deployer) de la wallet operativa del agente (worker).

Eso es justo lo que necesitan para un flujo de agentes verificable en producción/hackathon.
