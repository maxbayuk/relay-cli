# relay-cli: Agent Integration Guide

relay-cli is a command-line interface for the Relay Protocol cross-chain bridging and swap API. It dynamically generates commands from the OpenAPI spec at runtime — new endpoints appear automatically.

## Quick Start

```bash
# Install
npm install -g @relay-protocol/cli

# Or run directly
npx @relay-protocol/cli chains list
```

No API key needed for read endpoints. Set `RELAY_API_KEY` for execute endpoints.

## Invocation Contract

```bash
relay <command> [subcommand] [args...] --output json 2>/dev/null
```

- **stdout**: JSON data (always valid JSON when `--output json`)
- **stderr**: diagnostics, errors, warnings
- **exit 0**: success
- **exit 1**: failure (error details on stderr)

## Authentication

Resolution order (first match wins):
1. `--api-key <key>` flag
2. `RELAY_API_KEY` environment variable
3. `~/.relay-cli/config.json` → `{ "apiKey": "..." }`

Public endpoints (chains, quotes, requests, intents) need no auth. Execute endpoints require a valid API key.

## Input Modes

**Agent mode** (raw JSON body for POST endpoints):
```bash
relay quote --params '{"user":"0x...","originChainId":8453,"destinationChainId":1,"originCurrency":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913","destinationCurrency":"0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48","amount":"1000000","tradeType":"EXACT_INPUT"}'
```

**Human mode** (individual flags):
```bash
relay bridge --from base --to eth --token USDC --amount 1000000 --user 0x...
```

For agents, prefer `--params` with raw JSON — it maps directly to the API request body.

## Safety Tiers

| Tier | Endpoints | Behavior |
|------|-----------|----------|
| **read** | GET endpoints (chains, requests, intents, prices) | No restrictions |
| **quote** | POST /quote, /price, /currencies | `--dry-run` available, no confirmation needed |
| **execute** | POST /execute/*, /fast-fill, /app-fees/claim | **Requires `--confirm` flag**. Without it, prints error and exits. |

Execute endpoints move real money. The `--confirm` requirement is intentional — it prevents agents from accidentally submitting live transactions.

To preview without executing:
```bash
relay execute bridge --dry-run --params '{...}'
```

## Field Filtering

Relay API responses can be large (chains: 350KB). Use JMESPath to trim:

```bash
# 350KB → ~2KB
relay chains list --fields "chains[].{id: id, name: name, display: displayName}"

# Just the status
relay requests list --id 0x... --fields "requests[0].status"
```

Built-in presets:
```bash
relay chains list --preset slim        # id, name, displayName, vmType, depositEnabled
relay chains list --preset chains-health  # id, name, disabled, blockProductionLagging
```

## Schema Introspection

```bash
relay schema --list          # All endpoints with method, path, description
relay schema quote.v2        # Request params and response shape for /quote/v2
relay schema chains          # Response schema for /chains
```

Use this to discover parameter names and types before calling an endpoint.

## Error Handling

Route on error category, not message text. See `agents/error-catalog.json` for the full contract.

| Category | Retryable | Action |
|----------|-----------|--------|
| validation | No | Fix input params |
| api | No | Check error code, fix request |
| network | Yes | Backoff retry (1s initial, 30s max, 5 attempts) |
| rate_limit | Yes | Wait 5s, then backoff (60s max, 3 attempts) |
| server | Yes | Backoff retry (2s initial, 30s max, 3 attempts) |
| auth | No | Check API key |
| safety | No | Add --confirm or --dry-run |
| cache | No | Run `relay cache --clear` |
| parse | No | Check JSON syntax |

## Machine-Readable Resources

| File | Purpose |
|------|---------|
| `agents/tool-catalog.json` | All commands with parameter schemas, types, safety flags |
| `agents/error-catalog.json` | Error categories with retry strategies |
| `docs/relay-api-response-structures.md` | Field-by-field API response documentation with gotchas |

## Critical Gotchas

These are the mistakes AI agents make most often with the Relay API:

1. **Response wrapping**: `/chains` returns `{"chains": [...]}`, `/requests/v2` returns `{"requests": [...]}`. Never a bare array.
2. **Metadata nesting**: Request metadata lives at `requests[0].data.metadata`, NOT `requests[0].metadata`.
3. **solverAddresses is an array**: Each chain has `solverAddresses: ["0x...", "0x..."]` — iterate, don't string compare.
4. **Fees structure**: `{gas: "...", fixed: "...", price: "..."}`, NOT `{gas, relayer}`.
5. **Tx hash lookup**: Use `hash=` parameter on `/requests/v2`. The params `txHash=` and `inTxHash=` return unrelated results.
6. **outTxs stubs**: On failure/refund, `outTxs` is `[{"chainId": N}]` — no hash, no status. Don't treat this as a real transaction.
7. **intents/status only takes requestId**: Cannot look up by tx hash. Resolve hash → requestId via `/requests/v2?hash=` first.
8. **Non-standard chain IDs**: Bitcoin = 8253038, Sei = 792703809, Eclipse = 9286185. Don't assume all chains are EVM.
9. **Amounts are strings in wei**: `"1000000"` not `1000000`. Always strings, always smallest unit.
10. **Native token address**: `0x0000000000000000000000000000000000000000` (40 zeros) for ETH/native on any chain.
