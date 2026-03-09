# relay-cli

AI-native CLI for [Relay Protocol](https://relay.link)'s API — dynamically built from the OpenAPI spec at runtime.

[Relay](https://docs.relay.link) is a cross-chain payments protocol. It enables instant bridging and swapping across 80+ blockchains (Ethereum, Base, Arbitrum, Solana, Bitcoin, and more) using a solver network that fills orders from their own inventory, then settles on-chain. The API covers quoting, execution, request tracking, chain/currency discovery, and deposit address flows.

Inspired by [Justin Poehnelt's post on rewriting CLIs for AI agents](https://justin.poehnelt.com/posts/rewrite-your-cli-for-ai-agents/) and the [Google Workspace CLI](https://github.com/googleworkspace/cli), which dynamically generates its entire command surface from Google's Discovery Service. We apply the same pattern to Relay's OpenAPI spec.

## Contents

- [The Problem](#the-problem)
- [Quick Start](#quick-start)
- [For AI Agents](#for-ai-agents)
- [Commands](#commands)
- [Chain & Token Resolution](#chain--token-resolution)
- [Output Formats](#output-formats)
- [Field Filtering](#field-filtering)
- [Input Validation](#input-validation)
- [Safety Guards](#safety-guards)
- [Configuration](#configuration)
- [Examples](#examples)
- [Architecture](#architecture)
- [License](#license)

## The Problem

Relay's API has 47 endpoints (29 public, the rest internal/admin) across 80+ chains. AI agents are bad at using it:

- The chains response wraps in `{"chains": [...]}`, not a bare array — agents assume the wrong shape
- `solverAddresses` is an array per chain, not a string — agents do string comparison and get nothing
- The OpenAPI spec is 954KB with zero reusable schemas (everything inlined) — too large for context windows
- No schema introspection — agents guess at field names and response shapes

The existing SDK (`relay-kit`) is browser-focused (React hooks, wallet connection). There's nothing for terminal workflows or AI agents.

### Before & After

**Task:** Get solver wallet addresses and chain IDs from the Chains API.

**Without the CLI** — raw `GET /chains` returns **286KB** across 81 chains, each with **26 fields**:

```json
{
  "chains": [
    {
      "id": 1,
      "name": "ethereum",
      "displayName": "Ethereum",
      "httpRpcUrl": "https://ethereum.publicnode.com",
      "wsRpcUrl": "wss://ethereum.publicnode.com",
      "explorerUrl": "https://etherscan.io",
      "explorerName": "Etherscan",
      "depositEnabled": true,
      "tokenSupport": "All",
      "disabled": false,
      "partialDisableLimit": 0,
      "blockProductionLagging": false,
      "currency": { "id": "eth", "symbol": "ETH", "decimals": 18, "..." : "..." },
      "withdrawalFee": 0,
      "depositFee": 0,
      "surgeEnabled": false,
      "featuredTokens": ["... 5 token objects with metadata/logos ..."],
      "erc20Currencies": ["..."],
      "solverCurrencies": ["..."],
      "iconUrl": "...",
      "contracts": { "..." : "..." },
      "vmType": "evm",
      "baseChainId": null,
      "solverAddresses": ["0xf70d...", "0x56c2..."],
      "tags": ["..."],
      "protocol": "evm"
    }
  ]
}
```

An agent gets this 286KB blob, has to figure out the response wraps in `{"chains": [...]}` (not a bare array), then navigate 26 fields per chain to find `solverAddresses` — which is an array, not a string.

**With the CLI** — one command:

```bash
relay chains list --fields "chains[].{id: id, name: name, solvers: solverAddresses}"
```

Output is **12KB** (96% smaller), just what you need:

```json
[
  {
    "id": 1,
    "name": "ethereum",
    "solvers": [
      "0xf70da97812cb96acdf810712aa562db8dfa3dbef",
      "0x56c262027e0de4aea31d2489529cb25d23e58a8b",
      "0xabb2acd3be814a80e502575d6c1dc5f789e9cd10",
      "0xa67d7eb4dc68fa6ce8e34ef8cadaf075b9893fbb",
      "0xada5bb90d0de0bd1b6f3938708f49295a8d1f7cb"
    ]
  },
  {
    "id": 10,
    "name": "optimism",
    "solvers": ["0xf70da97812cb96acdf810712aa562db8dfa3dbef"]
  }
]
```

No guessing at response shape, no navigating 26 fields, no context window blowup. Agents can also run `relay schema chains` to inspect the response shape before making the call.

**Another example — request tracking:**

Raw `GET /requests/v2?id=0x6701...` returns **4.7KB** with 3 levels of nesting (`data.metadata.currencyIn.currency.symbol`), 20+ keys in `data` alone (fees, slippage, inTxs, outTxs, failReason, refundFailReason...).

With the CLI:

```bash
relay requests list --id 0x6701... --preset request-summary
```

```json
{
  "status": "failure",
  "user": "0xbf7e33e01a0e390dc554090afb06d546849ed59c",
  "recipient": "Ck6gNTVAZR69UrPEPc6vA3peAkLSxckadJXpLRqb3dny",
  "from": "G",
  "fromChain": 1625,
  "fromAmount": "14.657701729840066706",
  "fromUsd": "0.192045",
  "to": "SOL",
  "toChain": 792703809,
  "toAmount": "0.000171691",
  "toUsd": "0.035870",
  "feesUsd": { "gas": "0.030467", "fixed": "0.004858", "price": "0.000088", "gateway": "0.002183" },
  "referrer": "jmp",
  "createdAt": "2025-08-14T04:52:18.674Z"
}
```

4.7KB → 521 bytes. Status, amounts, fees, user, recipient — everything you need to triage a support ticket in one call.

## Quick Start

No API key required for public endpoints — start querying immediately.

```bash
# Install
npm install

# List all supported chains
npx tsx src/cli.ts chains list

# Check chain health
npx tsx src/cli.ts chains health

# Search for tokens on Base
npx tsx src/cli.ts currencies search --params '{"chainId": 8453, "term": "USDC"}'

# Get a quote for bridging USDC from Base to Ethereum
npx tsx src/cli.ts quote --params '{
  "user": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  "originChainId": 8453,
  "destinationChainId": 1,
  "originCurrency": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "destinationCurrency": "0x0000000000000000000000000000000000000000",
  "amount": "1000000"
}'

# Track a request
npx tsx src/cli.ts requests list --id 0x1234...

# Human-friendly table output
npx tsx src/cli.ts chains list --output table --fields "chains[0:10].{id: id, name: name, displayName: displayName}"
```

Output:
```
id   name      displayName
──────────────────────────
1    ethereum  Ethereum
10   optimism  Optimism
25   cronos    Cronos
56   bsc       BNB
100  gnosis    Gnosis
```

With an API key (optional — enables rate limit increases and execute endpoints):

```bash
# Set API key via environment variable
export RELAY_API_KEY=your-key

# Or persist in config
npx tsx src/cli.ts config set apiKey your-key

# Use testnet
npx tsx src/cli.ts --testnet chains list
```

### Smart Aliases

Shortcuts for common operations:

```bash
relay status 0x123...    # → GET /requests/v2?id=... (quick status lookup)
relay tx 0x123...        # → prints relay.link/transaction/... URL

# Human-friendly bridge quoting with chain names instead of IDs
relay bridge --from base --to eth --token USDC --amount 100 --user 0x...
```

## For AI Agents

The CLI is designed agent-first: structured JSON output by default, consistent error envelopes, schema introspection, and context window protection via field filtering.

### Core Invocation Pattern

```bash
# Agent pattern: JSON output, machine-parseable
node relay-cli/dist/cli.js <command> [flags] --output json 2>/dev/null

# Two input modes
--params '{"raw": "json"}'    # Maps directly to API body (preferred for agents)
--flag value                  # Individual flags (preferred for humans)
```

Exit codes: `0` = success, `1` = error (validation, HTTP, or runtime).

### Agent Resources

| File | Purpose |
|------|---------|
| `llms.txt` | Discovery entry point — links to all agent resources |
| `AGENTS.md` | Integration guide — invocation contract, safety tiers, gotchas |
| `CLAUDE.md` | Claude Code specific instructions and workflows |
| `agents/tool-catalog.json` | All 29 commands with parameter schemas, types, safety flags |
| `agents/error-catalog.json` | 9 error categories with retry strategies |
| `docs/relay-api-response-structures.md` | Field-by-field response docs with cross-status comparisons |

### Schema Introspection

Agents can query response shapes at runtime instead of guessing:

```bash
relay schema chains          # Response shape for GET /chains
relay schema quote.v2        # Request body schema for POST /quote/v2
relay schema --list          # All 29 public endpoints with methods
```

<details>
<summary>Why Agent-First?</summary>

Most CLIs are built for humans and later adapted for automation. This creates friction for AI agents:

1. **Context windows** — A 286KB chains response eats 25%+ of an agent's context. JMESPath filtering and built-in presets let agents request only the fields they need.
2. **Response shape discovery** — Agents hallucinate field names. Schema introspection (`relay schema <endpoint>`) gives them the actual shape before making calls.
3. **Safety by default** — Execute endpoints require `--confirm`. Agents can't accidentally submit live transactions. `--dry-run` prints the curl equivalent for review.
4. **Consistent error format** — Validation errors, HTTP errors, and runtime errors all follow the same structure. The error catalog documents retry strategies for each category.
5. **Auto-format detection** — TTY gets tables, pipes get JSON. No `--output json` flag needed in scripts.

</details>

## Commands

29 public commands across 7 groups, auto-generated from the OpenAPI spec. New endpoints appear automatically without code changes.

| Group | Commands | Description |
|-------|----------|-------------|
| Chains | 3 | Chain discovery, health checks, liquidity |
| Quoting | 2 | Price estimates and full quotes with steps |
| Execution | 6 | Bridge, swap, call, multi-input, permits, generic |
| Requests | 4 | Request tracking, metadata, signatures, status |
| Currencies | 5 | Token search, prices, trending, charts |
| App Fees | 3 | Fee balances, claiming, claim history |
| Utility | 6 | Schema, config, cache, status alias, tx link, bridge alias |

<details>
<summary>Full command reference</summary>

### Chains (Public)

| Command | Method | Description |
|---------|--------|-------------|
| `relay chains list` | GET | All 80+ supported chains with solver addresses, contracts, config |
| `relay chains health` | GET | Quick health check — which chains are up, lagging, or disabled |
| `relay chains liquidity` | GET | Liquidity data across chains |

### Quoting (Public)

| Command | Method | Description |
|---------|--------|-------------|
| `relay quote` | POST | Full quote for a cross-chain bridge or swap — includes steps, fees, time estimate |
| `relay price` | POST | Lightweight price estimate (no steps/txs, faster than quote) |

### Execution (Requires `--confirm` or `--dry-run`)

| Command | Method | Description |
|---------|--------|-------------|
| `relay execute bridge` | POST | Execute a cross-chain bridge transaction |
| `relay execute swap` | POST | Execute a same-chain or cross-chain swap |
| `relay execute call` | POST | Bridge + arbitrary contract call on destination |
| `relay execute swap-multi` | POST | Multi-input swap (multiple origin tokens → single destination) |
| `relay execute permits` | POST | Execute permit-based token approvals |
| `relay execute submit` | POST | Generic execute (submit signed transactions) |

### Requests & Tracking (Public)

| Command | Method | Description |
|---------|--------|-------------|
| `relay requests list` | GET | Get request details by ID, tx hash, or user address |
| `relay requests metadata` | POST | Submit metadata for a request |
| `relay requests signature` | GET | Get the signature for a request |
| `relay intents status` | GET | Lightweight status check (faster than /requests) |

### Currencies & Prices (Public)

| Command | Method | Description |
|---------|--------|-------------|
| `relay currencies search` | POST | Search for tokens across chains |
| `relay currencies token-price` | GET | Get token price by chain and address |
| `relay currencies trending` | GET | Trending tokens |
| `relay currencies chart` | GET | Price chart for a token |
| `relay prices rates` | GET | Current USD rates for tokens |

### App Fees

| Command | Method | Description |
|---------|--------|-------------|
| `relay app-fees balances` | GET | Claimable app fee balances for a wallet |
| `relay app-fees claim` | POST | Claim accumulated app fees (requires `--confirm`) |
| `relay app-fees claims` | GET | List past app fee claims |

### Other

| Command | Method | Description |
|---------|--------|-------------|
| `relay config get` | GET | Relay protocol configuration |
| `relay swap-sources` | GET | Available swap sources (DEX aggregators, AMMs) |
| `relay transactions index` | POST | Tell Relay to index a transaction |
| `relay transactions single` | POST | Get a single transaction by chain and hash |
| `relay fast-fill` | POST | Submit a fast-fill for a pending request (solver use, requires `--confirm`) |

</details>

## Chain & Token Resolution

### Chain Names

Fuzzy matching with aliases — use names instead of chain IDs:

```bash
relay bridge --from base --to eth --token USDC --amount 100 --user 0x...
# "base" → 8453, "eth" → 1
```

**Built-in aliases:**

| Alias | Chain | ID |
|-------|-------|----|
| `eth` | Ethereum | 1 |
| `base` | Base | 8453 |
| `arb` | Arbitrum | 42161 |
| `op` | Optimism | 10 |
| `poly`, `matic` | Polygon | 137 |
| `bnb` | BNB Smart Chain | 56 |
| `avax` | Avalanche | 43114 |
| `sol` | Solana | 792703809 |
| `btc` | Bitcoin | 8253038 |

Unknown input gets Dice-coefficient similarity suggestions:

```
Unknown chain "bae". Did you mean:
  8453 (Base)
  56 (BNB Smart Chain)
  1 (Ethereum)
```

### Token Symbols

USDC, USDT, and ETH are resolved to correct contract addresses per chain (Ethereum, Base, Optimism, Polygon, Arbitrum, Avalanche). The CLI handles the mapping so agents don't need to look up contract addresses.

## Output Formats

Three output formats, auto-detected based on environment.

### JSON (default for pipes/agents)

```bash
relay chains list --output json --fields "chains[0:3].{id: id, name: name}"
```
```json
[
  { "id": 1, "name": "ethereum" },
  { "id": 10, "name": "optimism" },
  { "id": 25, "name": "cronos" }
]
```

### Table (default for TTY/humans)

```bash
relay chains list --output table --fields "chains[0:5].{id: id, name: name, displayName: displayName}"
```
```
id   name      displayName
──────────────────────────
1    ethereum  Ethereum
10   optimism  Optimism
25   cronos    Cronos
56   bsc       BNB
100  gnosis    Gnosis
```

### Minimal (one value per line, tab-separated)

```bash
relay chains list --output minimal --fields "chains[0:5].{id: id, name: name}"
```
```
1	ethereum
10	optimism
25	cronos
56	bsc
100	gnosis
```

Auto-detection: TTY → table, pipe → JSON. Override with `--output <format>`.

### Errors

Validation errors are caught before HTTP requests:

```
$ relay requests list --id invalid
Validation errors:
  id: Request ID must start with 0x (got "invalid")
```

### Dry Run

Preview any POST request without executing it:

```bash
$ relay quote --params '{"user":"0xd8dA...","originChainId":8453,...}' --dry-run
```
```
curl -X POST 'https://api.relay.link/quote/v2' \
  -H 'Content-Type: application/json' \
  -d '{"user":"0xd8dA...","originChainId":8453,...}'
```

## Field Filtering

JMESPath expressions to shrink responses and protect context windows.

```bash
# 286KB chains response → ~2KB
relay chains list --fields "chains[].{id: id, name: name, display: displayName}"

# Just the request status
relay requests list --id 0x123... --fields "requests[0].status"

# Quote summary — fees, amounts, rate, time estimate
relay quote --params '{...}' --fields "details.{from: currencyIn.currency.symbol, to: currencyOut.currency.symbol, rate: rate, time: timeEstimate}"
```

### Built-in Presets

Common queries as named presets:

| Preset | Fields | Use Case |
|--------|--------|----------|
| `chains-slim` | id, name, displayName, vmType, depositEnabled | Chain overview |
| `chains-health` | id, name, disabled, blockProductionLagging | Monitoring |
| `chains-ids` | id, name | Lookup table |
| `request-status` | id, status, createdAt, updatedAt | Quick status check |
| `request-summary` | status, user, amounts, fees, timestamps | Full request overview |
| `quote-summary` | operation, tokens, amounts, rate, slippage, time | Quote comparison |
| `quote-fees` | relayerGas, relayerService, app, subsidized | Fee breakdown |

```bash
relay chains list --preset chains-slim
relay chains list --preset chains-health
relay requests list --id 0x123... --preset request-summary
```

## Input Validation

Validates before HTTP requests with helpful messages:

| Input | Validation | Example |
|-------|-----------|---------|
| Addresses | 0x-prefixed, 40 hex chars | `0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045` |
| Request IDs | 0x-prefixed, 64 hex chars | `0x1234567890abcdef...` |
| Chain IDs | Positive integers | `8453`, `1`, `42161` |
| Amounts | Numeric strings (wei, no decimals) | `"1000000"` |
| Tx hashes | 0x-prefixed, 64 hex chars | `0xabcdef...` |

Wrong address format? The CLI suggests corrections:

```
Address must start with 0x. Did you mean: 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045?
```

## Safety Guards

| Guard | What it does |
|-------|-------------|
| `--confirm` required | Execute endpoints (`/execute/bridge`, `/execute/swap`, etc.) refuse to run without `--confirm` — prevents agents from accidentally submitting live transactions |
| `--dry-run` | Available on all POST endpoints — prints the curl equivalent without executing |
| TTY detection | Table output for humans, JSON for scripts. No accidental raw JSON walls in terminals |
| Input validation | Catches bad addresses, chain IDs, amounts before the HTTP request is made |
| Testnet flag | `--testnet` switches to `api.testnets.relay.link` — test without touching mainnet |

## Configuration

### API Key

Three sources, in priority order:

1. **Flag**: `--api-key your-key` (highest priority)
2. **Environment**: `export RELAY_API_KEY=your-key`
3. **Config file**: `~/.relay-cli/config.json` (persisted, mode 0600)

```bash
# Set API key in config
relay config set apiKey your-key

# View current config
relay config get
```

### Cache

The OpenAPI spec is cached for 24 hours at `~/.relay-cli/cache/`.

```bash
# Force refresh
relay --refresh-cache chains list

# Clear all cached data
relay cache clear
```

### Testnet

```bash
# Use testnet API
relay --testnet chains list

# Testnet uses api.testnets.relay.link
```

## Examples

### Check if a chain is healthy before bridging

```bash
# Get health for all chains, filter to just status fields
relay chains health --fields "chains[].{id: id, name: name, disabled: disabled, lagging: blockProductionLagging}"
```

### Quote a bridge and extract the key details

```bash
relay quote \
  --params '{"user":"0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045","originChainId":8453,"destinationChainId":1,"originCurrency":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913","destinationCurrency":"0x0000000000000000000000000000000000000000","amount":"1000000"}' \
  --preset quote-summary
```

### Track a request through its lifecycle

```bash
# Quick status
relay status 0x1234...

# Full details with amounts and fees
relay requests list --id 0x1234... --preset request-summary

# Get the relay.link URL to share
relay tx 0x1234...
```

### Find solver addresses on a specific chain

```bash
# All chains with their solvers
relay chains list --fields "chains[].{id: id, name: name, solvers: solverAddresses}"

# Just one chain
relay chains list --fields "chains[?id==\`8453\`].{name: name, solvers: solverAddresses}"
```

### Agent workflow: quote → preview → execute

```bash
# 1. Get a quote
QUOTE=$(relay quote --params '{"user":"0x...","originChainId":8453,"destinationChainId":1,"originCurrency":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913","destinationCurrency":"0x0000000000000000000000000000000000000000","amount":"1000000"}')

# 2. Preview the execution (dry run)
relay execute bridge --params "$QUOTE" --dry-run

# 3. Execute for real (requires --confirm)
relay execute bridge --params "$QUOTE" --confirm
```

### Pipe JSON output to jq for ad-hoc queries

```bash
# Which chains have more than 1 solver?
relay chains list --output json | jq '[.chains[] | select(.solverAddresses | length > 1) | {id, name, count: (.solverAddresses | length)}]'

# All EVM chains
relay chains list --output json | jq '[.chains[] | select(.vmType == "evm") | .name]'
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

Zero runtime dependencies beyond these two. The CLI is ~800 lines of TypeScript.

## License

MIT
