# relay-cli: Claude Code Integration

This file configures Claude Code (and similar AI agents) to use relay-cli for interacting with the Relay Protocol API.

## Setup

Add to your MCP config or run directly:
```bash
relay <command> --output json 2>/dev/null
```

Always use `--output json` and redirect stderr. Parse stdout as JSON.

## Before You Start

Read `agents/tool-catalog.json` — it's the single source of truth for all 29 commands, their parameters, types, and safety flags.

Read `agents/error-catalog.json` — route on error category, never parse error message text.

## Safety Rules

**Never execute commands marked `dangerous` without explicit user confirmation.**

Dangerous commands (all `execute/*`, `fast-fill`, `app-fees claim`) require `--confirm`. The CLI will refuse to run them without it. This is correct behavior — do not try to bypass it.

Before executing any transaction:
1. Show the user what will happen (chain, token, amount, recipient)
2. Get explicit confirmation
3. Use `--dry-run` first to preview if there's any doubt

## Common Workflows

### Check request status
```bash
relay status 0x67015eb...
# or with field filtering
relay requests list --id 0x67015eb... --fields "requests[0].{status: status, origin: originChainId, dest: destinationChainId}"
```

### Look up by transaction hash
```bash
# CORRECT: use hash= parameter
relay requests list --hash 0xabc123...

# WRONG: txHash and inTxHash return unrelated results
# relay requests list --txHash 0xabc123...  ← DO NOT USE
```

### Get a cross-chain quote
```bash
# Human-friendly (resolves chain names + token symbols)
relay bridge --from base --to eth --token USDC --amount 1000000 --user 0x...

# Agent-friendly (raw API params)
relay quote --params '{"user":"0x...","originChainId":8453,"destinationChainId":1,"originCurrency":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913","destinationCurrency":"0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48","amount":"1000000","tradeType":"EXACT_INPUT"}'
```

### Check chain health
```bash
relay chains health --fields "chains[?disabled==\`true\`].{id: id, name: name}"
```

### Discover endpoint schemas
```bash
relay schema --list              # all endpoints
relay schema quote.v2            # params + response shape for /quote/v2
```

### Verify a solver address
```bash
relay chains list --fields "chains[].{id: id, name: name, solvers: solverAddresses}" | jq '.[] | select(.solvers[] == "0xTARGET...")'
```

## Response Shape Reminders

- `/chains` → `{ "chains": [...] }` — access `.chains`, not the root
- `/requests/v2` → `{ "requests": [...] }` — access `.requests[0]` for single results
- `/intents/status/v3` → flat object `{ status, requestId, txHashes: {...} }`
- Metadata: `requests[0].data.metadata` — nested inside `data`, not top-level
- Fees: `requests[0].data.fees.gas` / `.fixed` / `.price` (all strings in wei)
- `solverAddresses` is an array per chain — iterate, don't string compare

## What Not To Do

- Don't call `/intents/status` with a tx hash — it only accepts requestId
- Don't assume `outTxs` on a failed request contains a real transaction (it's a stub: `[{chainId: N}]`)
- Don't parse amounts as numbers — they're strings in wei and can overflow JS numbers
- Don't use `--params` with GET endpoints — use individual `--flags` instead
- Don't skip `--confirm` on execute endpoints by manipulating the CLI — the safety gate exists for a reason
