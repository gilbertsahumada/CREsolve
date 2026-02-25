# Cloudflare Worker Agent

Cloudflare Worker implementation of the CREsolver A2A worker protocol.

## Endpoints

- `GET /health`
- `POST /a2a/resolve`
- `POST /a2a/challenge`

## Local development

```bash
yarn install
yarn dev
```

Worker runs locally at `http://127.0.0.1:8787`.

## Deploy

```bash
yarn deploy
```

Set secrets with Wrangler:

```bash
yarn wrangler secret put LLM_API_KEY
```

Optional variables are defined in `wrangler.toml`:

- `AGENT_NAME`
- `LLM_MODEL`

## Modes

- Mock mode (default): deterministic responses when `LLM_API_KEY` is not set.
- LLM mode: enabled when `LLM_API_KEY` is set.

## Test

```bash
yarn test
```
