# relay-cli

AI-native CLI for [Relay Protocol](https://relay.link)'s API — dynamically built from the OpenAPI spec at runtime.

[Relay](https://docs.relay.link) is a cross-chain payments protocol. It enables instant bridging and swapping across 80+ blockchains (Ethereum, Base, Arbitrum, Solana, Bitcoin, and more) using a solver network that fills orders from their own inventory, then settles on-chain. The API covers quoting, execution, request tracking, chain/currency discovery, and deposit address flows.

Inspired by [Justin Poehnelt's post on rewriting CLIs for AI agents](https://justin.poehnelt.com/posts/rewrite-your-cli-for-ai-agents/) and the [Google Workspace CLI](https://github.com/googleworkspace/cli), which dynamically generates its entire command surface from Google's Discovery Service. We apply the same pattern to Relay's OpenAPI spec.

## The Problem

Relay's API has 47 endpoints (29 public, the rest internal/admin) across 80+ chains. AI agents are bad at using it:

- The chains response wraps in `{"chains": [...]}`, not a bare array — agents assume the wrong shape
- `solverAddresses` is an array per chain, not a string — agents do string comparison and get nothing
- The OpenAPI spec is 954KB with zero reusable schemas (everything inlined) — too large for context windows
- No schema introspection — agents guess at field names and response shapes

The existing SDK (`relay-kit`) is browser-focused (React hooks, wallet connection). There's nothing for terminal workflows or AI agents.

## What It Does

The CLI reads `api.relay.link/documentation/json` at startup, caches the spec (24h), and auto-generates commands for all 29 public endpoints. New endpoints appear automatically without code changes.

### Dynamic Commands from OpenAPI

```bash
relay chains list                           # GET /chains — all 80+ supported chains
relay chains health                         # GET /chains/health — which chains are up/down
relay quote --params '{"user":"0x...","originChainId":8453,...}'  # POST /quote/v2 — price a cross-chain transfer
relay requests list --id 0x123...           # GET /requests/v2 — track a request through its lifecycle
relay intents status --id 0x123...          # GET /intents/status/v3 — execution status with fill details
relay currencies list --chainId 8453        # GET /currencies — tokens available on a chain
relay execute bridge --params '{...}' --dry-run  # preview a bridge execution without submitting
```

Two input modes: `--params '{"raw": "json"}'` for agents (maps directly to API body) and individual `--flags` for humans.

### Chain Name Resolution

Fuzzy matching with aliases and suggestions:

```bash
relay bridge --from base --to eth --token USDC --amount 100 --user 0x...
# "base" → 8453, "eth" → 1, "USDC" → correct contract address per chain
```

Aliases: `eth`→ethereum, `arb`→arbitrum, `op`→optimism, `poly`/`matic`→polygon, `bnb`→bsc, `avax`→avalanche, `sol`→solana, `btc`→bitcoin

Unknown input gets Dice-coefficient similarity suggestions:
```
Unknown chain "bae". Did you mean:
  8453 (Base)
  56 (BNB Smart Chain)
  1 (Ethereum)
```

### Token Symbol Resolution

USDC, USDT, and ETH resolved to correct contract addresses per chain (Ethereum, Base, Optimism, Polygon, Arbitrum, Avalanche).

### Schema Introspection

Agents can query response shapes at runtime instead of guessing:

```bash
relay schema chains          # response shape for GET /chains
relay schema quote.v2        # request body schema for POST /quote/v2
relay schema --list          # all 29 public endpoints
```

### Field Filtering (Context Window Protection)

JMESPath expressions to shrink responses:

```bash
# 350KB chains response → ~2KB
relay chains list --fields "chains[].{id: id, name: name, display: displayName}"

# Just the status
relay requests list --id 0x123... --fields "requests[0].status"

# Built-in presets
relay chains list --preset slim      # id, name, displayName, vmType, depositEnabled
relay chains list --preset health    # id, name, disabled, blockProductionLagging
```

### Input Validation

Validates before HTTP requests with helpful messages:

- **Addresses**: 0x-prefixed, 40 hex chars (with "did you mean 0x...?" suggestions)
- **Request IDs**: 0x-prefixed, 64 hex chars
- **Chain IDs**: positive integers
- **Amounts**: numeric strings (wei, no decimals)
- **Tx hashes**: 0x-prefixed, 64 hex chars

### Safety Guards

- **Execute endpoints** (`/execute/bridge`, `/execute/swap`): require `--confirm` flag — prevents agents from accidentally submitting live transactions
- **`--dry-run`** on all POST endpoints: prints curl equivalent without executing
- **Auto-detect TTY vs pipe**: table output for humans, JSON for scripts/agents

### Smart Aliases

```bash
relay status 0x123...              # → GET /requests/v2?id=...
relay tx 0x123...                  # → prints relay.link/transaction/... URL
relay bridge --from base --to eth --token USDC --amount 100 --user 0x...
```

## Setup

```bash
# Install dependencies
npm install

# Run in development
npx tsx src/cli.ts chains list

# Set API key (optional — some endpoints are public)
export RELAY_API_KEY=your-key
# or
npx tsx src/cli.ts config set apiKey your-key

# Use testnet
npx tsx src/cli.ts --testnet chains list
```

## Architecture

```
src/
├── cli.ts                    # Entry point, commander setup, smart aliases
└── core/
    ├── spec-loader.ts        # Fetch + cache OpenAPI spec (24h TTL)
    ├── command-builder.ts    # OpenAPI paths → commander commands at runtime
    ├── executor.ts           # HTTP execution, curl generation, error handling
    ├── formatter.ts          # JSON / table / minimal output + JMESPath presets
    ├── validator.ts          # Address/chainId/requestId/amount validation
    ├── chain-resolver.ts     # Chain name→ID fuzzy matching + token resolution
    ├── cache.ts              # Disk cache (~/.relay-cli/cache/) with TTL
    └── auth.ts               # API key: env → config → flag priority
```

### How It Works

1. On startup, fetches the OpenAPI spec from `api.relay.link/documentation/json` (cached 24h)
2. Filters out admin/internal endpoints (29 public remain)
3. Deduplicates versioned paths (`/quote` + `/quote/v2` → keeps v2 only)
4. Generates commander subcommands with appropriate flags for each endpoint
5. On command execution: validates inputs → resolves chains/tokens → makes HTTP request → formats output

### Dependencies

| Package | Purpose |
|---------|---------|
| `commander` | CLI framework with programmatic command building |
| `jmespath` | JMESPath field filtering for response data |

## Agent Integration

The repo includes machine-readable contracts for AI agent discovery (inspired by [Kraken CLI](https://github.com/krakenfx/kraken-cli)):

| File | Purpose |
|------|---------|
| `llms.txt` | Discovery entry point — links to all agent resources |
| `AGENTS.md` | Integration guide — invocation contract, safety tiers, gotchas |
| `CLAUDE.md` | Claude Code specific instructions and workflows |
| `agents/tool-catalog.json` | All 29 commands with parameter schemas, types, safety flags |
| `agents/error-catalog.json` | 9 error categories with retry strategies |
| `docs/relay-api-response-structures.md` | Field-by-field response docs with cross-status comparisons |

