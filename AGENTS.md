# relay-cli: Agent Integration Guide

CLI for the Relay Protocol cross-chain bridging/swap API. Commands are dynamically generated from the OpenAPI spec — new endpoints appear automatically.

## Quick Start

```bash
npx @relay-protocol/cli chains list
```

No API key needed for read endpoints. Set `RELAY_API_KEY` for authenticated endpoints.

## Invocation Contract

```bash
relay <command> [subcommand] [args...] --output json 2>/dev/null
```

- **stdout**: always valid JSON when `--output json`
- **stderr**: diagnostics, errors, warnings
- **exit 0**: success | **exit 1**: failure

## Authentication

Resolution order (first match wins):
1. `--api-key <key>` flag
2. `RELAY_API_KEY` environment variable
3. `~/.relay-cli/config.json` → `{ "apiKey": "..." }`

## Input Modes

**Agent mode** (POST endpoints): `--params '{"user":"0x...","originChainId":8453,...}'` — maps directly to API body.

**Human mode**: `relay bridge --from base --to eth --token USDC --amount 1000000 --user 0x...`

## Field Filtering

Responses can be large (chains: 350KB). Use `--fields` (JMESPath) or `--preset`:

```bash
relay chains list --fields "chains[].{id: id, name: name}"  # 350KB → ~2KB
relay chains list --preset slim                               # built-in preset
relay requests list --id 0x... --fields "requests[0].status"
```

## Schema Introspection

```bash
relay schema --list          # all endpoints
relay schema quote.v2        # params + response shape for /quote/v2
```

## Error Handling

Route on error category, not message text. See `agents/error-catalog.json` for categories, retry strategies, and guidance.

## Machine-Readable Contracts

| File | Purpose |
|------|---------|
| `agents/tool-catalog.json` | All commands with parameter schemas, types, and per-command gotchas |
| `agents/error-catalog.json` | Error categories with retry strategies |
| `docs/relay-api-response-structures.md` | Field-by-field API response docs |

## Critical Gotchas

Per-command gotchas are in `tool-catalog.json`. These are global:

1. **Non-standard chain IDs**: Bitcoin = 8253038, Sei = 792703809, Eclipse = 9286185. Not all chains are EVM.
2. **Amounts are strings in wei**: `"1000000"` not `1000000`. Always strings, always smallest unit.
3. **Native token address**: `0x0000000000000000000000000000000000000000` (40 zeros) for ETH/native on any chain.
4. **intents/status only takes requestId**: Cannot look up by tx hash. Resolve hash → requestId via `/requests/v2?hash=` first.
