# Relay API Response Structures

Field-by-field documentation for the Pylon AI agent. Every field path, data type, plain-english meaning, and gotchas for the primary API endpoints.

---

## 1. GET /intents/status/v3

**Purpose:** Lightweight status check. Use this first — it's fast and tells you whether to dig deeper.

**Request:** `GET https://api.relay.link/intents/status/v3?requestId=<requestId>`

### Response Fields

| Field | Type | Meaning |
|-------|------|---------|
| `status` | `string` | Current state: `"pending"`, `"success"`, `"failure"`, `"refund"`, `"delayed"` |
| `details` | `string` | Only present on `failure`/`refund` — human-readable reason (e.g., `"Could not fill request"`, `"Refunding"`) |
| `inTxHashes` | `string[]` | Origin chain deposit tx hash(es). Usually 1 element. |
| `txHashes` | `string[]` | Destination chain fill/refund tx hash(es). Empty array `[]` on failure if no fill happened. |
| `updatedAt` | `number` | Unix timestamp in **milliseconds** (not seconds). Last status change. |
| `originChainId` | `number` | Chain ID where funds were deposited (e.g., 137 for Polygon). |
| `destinationChainId` | `number` | Chain ID where funds were/should be delivered (e.g., 1 for Ethereum). |

### Status-specific differences

| Status | `details` | `txHashes` |
|--------|-----------|------------|
| `success` | absent | `["0x..."]` — the fill tx |
| `pending` | absent | `[]` |
| `failure` | `"Could not fill request"` or similar | `[]` — no fill happened |
| `refund` | `"Refunding"` or similar | `["0x..."]` — the refund tx |

### Gotchas
- `updatedAt` is milliseconds, not seconds. Divide by 1000 for JS `Date`.
- `details` field only appears on non-success statuses. Don't check `details` on success — it's undefined.
- `txHashes` is always an array, never a single string. Can be empty.
- Chain IDs can include non-standard values (e.g., `1337` for Relay internal, `792703809` for Sei).

---

## 2. GET /requests/v2

**Purpose:** Full request details including tx data, fees, metadata, state changes. Use after intents/status shows something interesting.

**Request:**
- By requestId: `GET https://api.relay.link/requests/v2?id=<requestId>`
- By deposit tx hash: `GET https://api.relay.link/requests/v2?hash=<depositTxHash>`

### Top-Level Response

```
{
  "requests": [Request]   // Always an array, usually 1 element
}
```

**The response wraps in `{"requests": [...]}` — it is NOT a bare object.**

When looking up by hash, the array may contain 0 elements if the hash isn't recognized.

### Request Object — Top-Level Fields

| Field | Type | Meaning |
|-------|------|---------|
| `id` | `string` | The requestId (0x-prefixed, 66 chars). Primary identifier. |
| `status` | `string` | Same values as intents/status: `"success"`, `"pending"`, `"failure"`, `"refund"` |
| `user` | `string` | Wallet address that initiated the request (lowercase). |
| `recipient` | `string` | Wallet address that receives the output funds (may differ from user). |
| `referrer` | `string` | Integrator identifier, pipe-separated: `"funxyz\|su4gnoxz14"`, `"tria-mobile"`. Tells you which app initiated this. |
| `createdAt` | `string` | ISO 8601 timestamp: `"2026-03-04T14:29:16.438Z"` |
| `updatedAt` | `string` | ISO 8601 timestamp of last update. |
| `data` | `object` | All detailed transaction data (see below). |

### `data` — Core Fields

| Field Path | Type | Meaning |
|------------|------|---------|
| `data.slippageTolerance` | `string` | Slippage in bps as a string. `"200"` = 2%. `"0"` = no slippage. |
| `data.failReason` | `string` | Why the request failed. `"N/A"` on success. `"UNKNOWN"` when no specific reason. Other values: `"AMOUNT_TOO_LOW"`, `"UNSUPPORTED_ROUTE"`, etc. |
| `data.refundFailReason` | `string` | If a refund was attempted but failed. `"N/A"` when refund succeeded or wasn't needed. |
| `data.subsidizedRequest` | `boolean` | Whether Relay subsidized fees for this request. |
| `data.price` | `string` | Raw output amount in smallest units (wei/satoshi). |
| `data.usesExternalLiquidity` | `boolean` | Whether an external DEX was used vs direct bridge. |
| `data.timeEstimate` | `number` | Estimated fill time in seconds (e.g., `6.5`, `7`). |
| `data.currency` | `string` | Short name of the currency: `"usdc"`, `"eth"`. |
| `data.currencyObject` | `object` | Full currency details. Can be empty `{}` in some cases. |
| `data.feeCurrency` | `string` | Currency used for fees (may differ from transfer currency). |
| `data.feeCurrencyObject` | `object` | Full fee currency object: `{chainId, address, symbol, name, decimals, metadata}`. |
| `data.appFeeCurrencyObject` | `object` | Currency object for app fees (integrator fees). |

### `data.fees` — Fee Breakdown (Raw Amounts)

| Field Path | Type | Meaning |
|------------|------|---------|
| `data.fees.gas` | `string` | Gas cost in smallest currency units. |
| `data.fees.fixed` | `string` | Fixed protocol fee. Usually `"0"`. |
| `data.fees.price` | `string` | Price impact / spread fee. |

### `data.feesUsd` — Fee Breakdown (USD)

| Field Path | Type | Meaning |
|------------|------|---------|
| `data.feesUsd.gas` | `string` | Gas cost in USD: `"0.520768"`. |
| `data.feesUsd.fixed` | `string` | Fixed fee in USD: `"0.000000"`. |
| `data.feesUsd.price` | `string` | Price/spread fee in USD. |

### `data.appFees` — Integrator Fees

Array of fee objects taken by the integrating app:

| Field Path | Type | Meaning |
|------------|------|---------|
| `data.appFees[].recipient` | `string` | Address receiving the fee. |
| `data.appFees[].bps` | `string` | Fee in basis points as string: `"6"` = 0.06%. |
| `data.appFees[].amount` | `string` | Raw fee amount in smallest units. |
| `data.appFees[].amountUsd` | `string` | Fee amount in USD at time of quote. |
| `data.appFees[].amountUsdCurrent` | `string` | Fee amount in USD at current prices. |

`data.paidAppFees` has the same structure — what was actually paid (vs what was quoted).

### `data.refundCurrencyData` — Refund Details

**Only present when status is `"refund"`.** Null/absent on success and failure.

| Field Path | Type | Meaning |
|------------|------|---------|
| `data.refundCurrencyData.currency` | `object` | Full currency object for the refund (chainId, address, symbol, name, decimals, metadata). |
| `data.refundCurrencyData.amount` | `string` | Refund amount in smallest units. |
| `data.refundCurrencyData.amountFormatted` | `string` | Human-readable: `"748.994351"`. |
| `data.refundCurrencyData.amountUsd` | `string` | USD value: `"748.995100"`. |
| `data.refundCurrencyData.minimumAmount` | `string` | Minimum guaranteed refund amount. |

### `data.inTxs` — Origin Chain Transactions

Array of deposit transactions (usually 1 element):

| Field Path | Type | Meaning |
|------------|------|---------|
| `data.inTxs[].hash` | `string` | Transaction hash on origin chain. |
| `data.inTxs[].block` | `number` | Block number. |
| `data.inTxs[].type` | `string` | Always `"onchain"`. |
| `data.inTxs[].chainId` | `number` | Origin chain ID. |
| `data.inTxs[].timestamp` | `number` | Unix timestamp in **seconds** (not milliseconds like intents/status). |
| `data.inTxs[].status` | `string` | `"success"` for confirmed deposit. |
| `data.inTxs[].fee` | `string` | Gas fee paid in wei (as string). |
| `data.inTxs[].data.to` | `string` | Contract called (deposit contract). |
| `data.inTxs[].data.from` | `string` | Sender address. |
| `data.inTxs[].data.value` | `string` | ETH value sent (usually `"0"` for ERC20). |
| `data.inTxs[].data.data` | `string` | Raw calldata (hex). |
| `data.inTxs[].stateChanges` | `array` | Token balance changes (see below). |

### `data.outTxs` — Destination Chain Transactions

Same structure as `inTxs` but for the fill (or refund) on the destination chain.

**Critical status-dependent differences:**

| Request Status | `outTxs` Content |
|----------------|------------------|
| `success` | Full tx object with hash, block, stateChanges, status=`"success"` |
| `refund` | Full tx object — the refund tx (may be on origin chain, not destination) |
| `failure` | Minimal object: just `{chainId: <number>}` — no hash, no data |
| `pending` | Empty array `[]` or minimal stub |

### `data.inTxs[].stateChanges` / `data.outTxs[].stateChanges`

Array of balance changes:

| Field Path | Type | Meaning |
|------------|------|---------|
| `stateChanges[].address` | `string` | Address whose balance changed. |
| `stateChanges[].change.kind` | `string` | `"token"` for ERC20, `"native"` for ETH. |
| `stateChanges[].change.balanceDiff` | `string` | Signed amount: `"-750000000"` (sent) or `"750000000"` (received). |
| `stateChanges[].change.data.tokenKind` | `string` | `"ft"` for fungible token. |
| `stateChanges[].change.data.tokenAddress` | `string` | Token contract address. |

### `data.metadata` — Quote Metadata

| Field Path | Type | Meaning |
|------------|------|---------|
| `data.metadata.sender` | `string` | Mixed-case sender address. |
| `data.metadata.recipient` | `string` | Mixed-case recipient address. |
| `data.metadata.rate` | `string` | Exchange rate as decimal string: `"0.998725924"`. |
| `data.metadata.currencyIn` | `object` | Full input currency with amounts (see below). |
| `data.metadata.currencyOut` | `object` | Full output currency with amounts (see below). |
| `data.metadata.route` | `object` | Route details (origin + destination with router names). |

### `data.metadata.currencyIn` / `data.metadata.currencyOut`

| Field Path | Type | Meaning |
|------------|------|---------|
| `.currency.chainId` | `number` | Chain ID for this currency. |
| `.currency.address` | `string` | Token contract address. |
| `.currency.symbol` | `string` | `"USDC"`, `"ETH"`, `"USDC.e"`, etc. |
| `.currency.name` | `string` | Full name: `"USD Coin"`. |
| `.currency.decimals` | `number` | Token decimals (6 for USDC, 18 for ETH). |
| `.currency.metadata.logoURI` | `string` | Logo URL. |
| `.currency.metadata.verified` | `boolean` | Whether token is verified. |
| `.amount` | `string` | Raw amount in smallest units. |
| `.amountFormatted` | `string` | Human-readable: `"750.0"`. |
| `.amountUsd` | `string` | USD value at time of quote. |
| `.amountUsdCurrent` | `string` | USD value at current prices. |
| `.minimumAmount` | `string` | Minimum guaranteed amount. |

### `data.metadata.route`

| Field Path | Type | Meaning |
|------------|------|---------|
| `data.metadata.route.origin.inputCurrency` | `object` | Same currency+amount structure as above. |
| `data.metadata.route.origin.outputCurrency` | `object` | What came out of the origin swap (if any). |
| `data.metadata.route.origin.router` | `string` | Router used: `"relay"`, `"1inch"`, etc. |
| `data.metadata.route.destination.inputCurrency` | `object` | What the solver received. |
| `data.metadata.route.destination.outputCurrency` | `object` | What was delivered to recipient. |
| `data.metadata.route.destination.router` | `string` | Router used on destination. |

---

## 3. POST /transactions/index

**Purpose:** Tell Relay to index/track a transaction. Used when a deposit was made outside the normal flow and Relay hasn't picked it up yet.

**Request:**
```json
POST https://api.relay.link/transactions/index
Content-Type: application/json

{
  "txHash": "0x...",    // string — the deposit tx hash
  "chainId": 8453       // number — chain ID where the tx happened
}
```

**Response:**
```json
{
  "message": "Success"
}
```

That's it. The response is always `{"message": "Success"}` if the request was accepted. It does not return the request data — you need to poll `/requests/v2` or `/intents/status/v3` afterward.

### Gotchas
- Returns `"Success"` even if the tx hash doesn't correspond to a valid Relay deposit. It just queues indexing.
- No error response for unknown hashes — only errors on malformed input.
- `chainId` must be a number, not a string.

---

## 4. Cross-Status Comparison

### How field values differ by request status

| Field | `success` | `failure` | `refund` | `pending` |
|-------|-----------|-----------|----------|-----------|
| `status` | `"success"` | `"failure"` | `"refund"` | `"pending"` |
| `failReason` | `"N/A"` | `"UNKNOWN"` or specific code | `"UNKNOWN"` or specific code | `"N/A"` |
| `refundFailReason` | `"N/A"` | `"N/A"` | `"N/A"` if refund succeeded, specific error if failed | `"N/A"` |
| `refundCurrencyData` | `null`/absent | `null`/absent | Full object with currency, amount, amountFormatted, amountUsd | `null`/absent |
| `outTxs` | Full tx object (fill) | Minimal: `[{chainId: N}]` only | Full tx object (refund tx) | `[]` empty array |
| `outTxs[0].hash` | Present | **Absent** | Present (refund tx hash) | N/A |
| `outTxs[0].status` | `"success"` | **Absent** | `"success"` | N/A |
| `outTxs[0].stateChanges` | Present | **Absent** | Present (refund transfers) | N/A |
| `paidAppFees` | Present (fees actually paid) | May be present/absent | Present | May be absent |

### intents/status/v3 differences by status

| Field | `success` | `failure` | `refund` | `pending` |
|-------|-----------|-----------|----------|-----------|
| `details` | **Absent** | `"Could not fill request"` | `"Refunding"` | **Absent** |
| `txHashes` | `["0x..."]` fill hash | `[]` empty | `["0x..."]` refund hash | `[]` empty |
| `inTxHashes` | `["0x..."]` deposit hash | `["0x..."]` deposit hash | `["0x..."]` deposit hash | `["0x..."]` or `[]` |

---

## 5. Key Gotchas Summary

### Timestamp formats are inconsistent
- `intents/status/v3` → `updatedAt` is **milliseconds** (e.g., `1772654586818`)
- `requests/v2` → `createdAt` / `updatedAt` are **ISO 8601 strings** (e.g., `"2026-03-04T14:29:16.438Z"`)
- `requests/v2` → `data.inTxs[].timestamp` is **seconds** (e.g., `1772634555`)
- Three different timestamp formats across the same API surface.

### String vs number inconsistency
- `slippageTolerance`: string (`"200"`) not number
- `fees.gas`, `fees.fixed`, `fees.price`: strings not numbers
- `appFees[].bps`: string (`"6"`) not number
- `price`: string not number
- `chainId` in response objects: number
- `timeEstimate`: number (float, e.g., `6.5`)

### Null vs "N/A" vs absent
- `failReason`: `"N/A"` on success (not null, not absent)
- `refundFailReason`: `"N/A"` on success and when refund succeeded
- `refundCurrencyData`: `null` or completely absent on non-refund
- `details` in intents/status: completely absent on success/pending (not null, not "N/A")
- `currencyObject`: can be empty `{}` even when `currency` string is present

### outTxs structure changes by status
- Success: full object with hash, block, data, stateChanges, status, fee, timestamp
- Failure: **minimal stub** — just `{chainId: N}`. No hash, no data, no status.
- Refund: full object (the refund transaction, which may be on a different chain than `destinationChainId`)
- Don't assume outTxs[0].hash exists — check status first.

### Response wrapping
- `/requests/v2` wraps in `{"requests": [...]}` — always an array
- `/intents/status/v3` returns a bare object (no wrapping)
- `/transactions/index` returns `{"message": "Success"}`

### Address casing
- `user` and `recipient` at top level: lowercase
- `data.metadata.sender` and `data.metadata.recipient`: mixed-case (checksummed)
- `data.inTxs[].data.from`: mixed-case
- Always normalize to lowercase before comparing addresses.

### Referrer format
- Pipe-separated: `"funxyz|su4gnoxz14"` — first segment is the integrator name, rest is metadata
- Some are simple strings: `"tria-mobile"`
- Parse by splitting on `|` and taking index 0 for integrator identification.

### Chain ID edge cases
- Internal/test chains use non-standard IDs: `1337` (Relay internal)
- `792703809` is Sei
- Always validate chain IDs against the chains API response, not a hardcoded list.

### Fee currency vs transfer currency
- `data.currency` / `data.currencyObject`: the bridged asset
- `data.feeCurrency` / `data.feeCurrencyObject`: what fees are denominated in
- These can differ (e.g., bridge USDC but pay fees in USDC.e on Polygon)
- `data.appFeeCurrencyObject`: can differ from both

### When to use which endpoint
- **Quick status check:** `intents/status/v3` — 6 fields, fast
- **Full investigation:** `requests/v2` by requestId — everything including tx data, fees, state changes
- **Find request from tx hash:** `requests/v2` by hash — same response as by requestId
- **Trigger indexing:** `transactions/index` — for deposits not yet tracked
- **Chain lookup / infrastructure verification:** `chains` — solver addresses, depositories, chain health

---

## 6. GET /chains

**Purpose:** Full chain registry — supported chains, solver addresses, contract addresses, supported currencies, and operational status. This is the source of truth for "what does Relay support" and critical for infrastructure address verification.

**Request:** `GET https://api.relay.link/chains`

### Response Wrapping

```
{
  "chains": [Chain]   // Array of 80+ chain objects. NOT a bare array.
}
```

**The response wraps in `{"chains": [...]}` — access `.chains` key first.**

Via CLI: `relay chains list` / `relay chains list --preset chains-slim`

### Chain Object — Core Fields

| Field | Type | Present On | Meaning |
|-------|------|-----------|---------|
| `id` | `number` | All | Chain ID (e.g., `1` for Ethereum, `8453` for Base, `8253038` for Bitcoin). |
| `name` | `string` | All | Lowercase slug: `"ethereum"`, `"base"`, `"bitcoin"`. Used in API calls and CLI aliases. |
| `displayName` | `string` | All | Human-readable: `"Ethereum"`, `"Base"`, `"Bitcoin"`. |
| `vmType` | `string` | All | VM type: `"evm"` (73 chains), `"svm"` (3), `"bvm"` (1), `"hypevm"` (1), `"lvm"` (1), `"tvm"` (1). |
| `baseChainId` | `number` | All | The L1 chain this is built on (e.g., `1` for Ethereum L2s). |

### Operational Status

| Field | Type | Meaning |
|-------|------|---------|
| `depositEnabled` | `boolean` | Whether deposits are accepted on this chain. |
| `disabled` | `boolean` | Whether the chain is fully disabled. Check this first for outages. |
| `blockProductionLagging` | `boolean` | Whether block production is behind. Can be `true` even when `disabled` is `false`. |
| `partialDisableLimit` | `number` | If > 0, transfers above this USD amount are disabled. `0` = no limit. |
| `surgeEnabled` | `boolean` | Whether surge pricing is active (higher fees during congestion). |
| `tokenSupport` | `string` | `"All"` (51 chains) or `"Limited"` (29 chains). |

### Fee Fields

| Field | Type | Meaning |
|-------|------|---------|
| `withdrawalFee` | `number` | Fee in bps for withdrawals from this chain. Most chains: `0`. Examples: Optimism `1`, BNB `5`, Cronos `25`, Unichain `50`. |
| `depositFee` | `number` | Fee in bps for deposits. Usually `0`. |

### Native Currency

| Field Path | Type | Meaning |
|------------|------|---------|
| `currency.id` | `string` | Short ID: `"eth"`, `"btc"`, `"matic"`. |
| `currency.symbol` | `string` | Display symbol: `"ETH"`, `"BTC"`. |
| `currency.name` | `string` | Full name: `"Ether"`, `"Bitcoin"`. |
| `currency.address` | `string` | Native currency address. EVM: `"0x0000000000000000000000000000000000000000"`. BTC: `"bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8"`. SVM: `"11111111111111111111111111111111"`. |
| `currency.decimals` | `number` | `18` for ETH, `8` for BTC, etc. |
| `currency.supportsBridging` | `boolean` | Whether the native currency can be bridged. |

### Solver Addresses (CRITICAL)

| Field | Type | Meaning |
|-------|------|---------|
| `solverAddresses` | `string[]` | **Array of solver wallet addresses for this chain.** 1–21 addresses per chain (avg 1.5). |

**This is the #1 gotcha.** `solverAddresses` is an ARRAY, not a string. Any code that does string comparison (`solverAddresses === addr`) will fail silently. You must iterate:

```javascript
// WRONG
chain.solverAddresses === address

// RIGHT
chain.solverAddresses.some(a => a.toLowerCase() === address.toLowerCase())
```

Via CLI: `relay chains list --fields "chains[?id==\`8453\`].solverAddresses"`

### Protocol / Depository Addresses

| Field Path | Type | Meaning |
|------------|------|---------|
| `protocol.v2.chainId` | `string` | Protocol-level chain identifier (may differ from numeric ID). |
| `protocol.v2.depository` | `string` | Deposit contract address for this chain. Where user funds land on the origin chain. |
| `protocol.v2.depositoryVault` | `string` | Present on only 3 chains. Secondary deposit vault address. |

### Contract Addresses

| Field Path | Type | Meaning |
|------------|------|---------|
| `contracts.multicall3` | `string` | Multicall3 contract. Empty string `""` on non-EVM chains. |
| `contracts.multicaller` | `string` | Relay multicaller contract. |
| `contracts.onlyOwnerMulticaller` | `string` | Owner-restricted multicaller. |
| `contracts.relayReceiver` | `string` | Relay receiver contract. |
| `contracts.erc20Router` | `string` | ERC20 router (v2). |
| `contracts.approvalProxy` | `string` | Approval proxy (v2). |
| `contracts.v3.erc20Router` | `string` | ERC20 router (v3). |
| `contracts.v3.approvalProxy` | `string` | Approval proxy (v3). |

Non-EVM chains (BTC, SVM) have all contract fields as empty strings `""`.

### Token Lists

Three separate token arrays per chain:

| Field | Type | Meaning |
|-------|------|---------|
| `featuredTokens` | `object[]` | Highlighted tokens for UI display. Includes `metadata.logoURI`. |
| `erc20Currencies` | `object[]` | All supported ERC20 tokens. Present on 48/80 chains. Each has: `id`, `symbol`, `name`, `address`, `decimals`, `supportsBridging`, `withdrawalFee`, `depositFee`, `surgeEnabled`. |
| `solverCurrencies` | `object[]` | Tokens the solver can fill. Present on all 80 chains. Subset of erc20Currencies. Each has: `id`, `symbol`, `name`, `address`, `decimals`. |

### URLs and Display

| Field | Type | Present On | Meaning |
|-------|------|-----------|---------|
| `httpRpcUrl` | `string` | All | Public RPC endpoint. |
| `wsRpcUrl` | `string` | All | WebSocket RPC. Empty string `""` when unavailable (e.g., Bitcoin). |
| `explorerUrl` | `string` | All | Block explorer base URL: `"https://etherscan.io"`. |
| `explorerName` | `string` | All | Explorer name: `"Etherscan"`, `"MempoolSpace"`. |
| `explorerPaths` | `object` | 2 chains | Custom path templates: `{"transaction": "/logs/{TX_HASH}", "address": "/accounts/{ADDRESS}"}`. |
| `iconUrl` | `string` | All | Chain icon URL. |
| `logoUrl` | `string` | 6 chains | Alternative logo (only some chains). |
| `brandColor` | `string` | 3 chains | Hex color for UI theming. |
| `tags` | `string[]` | All | Currently empty on all chains. Reserved for future use. |

---

## 7. GET /chains/health

**Purpose:** Quick health check for a single chain. Simpler than parsing the full chains response.

**Request:** `GET https://api.relay.link/chains/health?chainId=<chainId>`

**Response:**
```json
{"healthy": true}
```
or
```json
{"healthy": false}
```

Single boolean. `chainId` parameter is **required** — omitting it returns a 400 error.

Via CLI: `relay chains health --chainId 1`

---

## 8. Chains API Gotchas

### solverAddresses is an ARRAY
This is the original problem that inspired building the CLI. Claude Code couldn't find solver addresses because it did `chain.solverAddresses === addr` instead of iterating the array. Every chain has 1–21 solver addresses. Always iterate.

### Response wrapping
`{"chains": [...]}` — not a bare array. This is the second most common agent mistake after solverAddresses.

### Empty strings vs absent
Non-EVM chains (BTC, SVM) have all contract addresses as empty strings `""`, not null or absent. Check for empty string, not just truthiness.

### Address formats vary by vmType
- EVM: `0x`-prefixed, 42 chars (e.g., `0xf70da97812cb96acdf810712aa562db8dfa3dbef`)
- BTC: bech32 format (e.g., `bc1qq2mvrp4g3ugd424dw4xv53rgsf8szkrv853jrc`)
- SVM: base58, 32-44 chars (e.g., `11111111111111111111111111111111`)
- Depository on BTC: legacy format (`1KT3zCYUrmQxjcveUNs1Rs7WcXDcPQZ4av`)

### Non-standard chain IDs
- `8253038` = Bitcoin
- `792703809` = Sei
- `1337` = Relay internal
- Don't hardcode chain IDs — always look up from the chains API.

### erc20Currencies vs solverCurrencies
- `erc20Currencies`: all supported tokens. Present on 48/80 chains. Has fee fields.
- `solverCurrencies`: tokens the solver can actually fill. Present on all 80 chains. No fee fields.
- For "can this token be bridged?" → check `solverCurrencies`
- For "what fees apply?" → check `erc20Currencies`
- A token in `erc20Currencies` but not in `solverCurrencies` means it's recognized but can't be filled by the solver.

### Infrastructure address verification workflow
Before blocking or flagging ANY address, verify it's not a Relay infrastructure address:
1. Fetch `/chains`
2. For each chain, check `solverAddresses[]` (array!), `protocol.v2.depository`, `protocol.v2.depositoryVault`, and all `contracts.*` addresses
3. Compare case-insensitively (lowercase both sides)

Via CLI: `relay chains list --fields "chains[].{id: id, solvers: solverAddresses, depository: protocol.v2.depository}"`
