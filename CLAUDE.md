# relay-cli: Claude Code Integration

Read `agents/tool-catalog.json` for all commands, parameters, and per-command gotchas.
Read `agents/error-catalog.json` for error categories and retry strategies.
Read `agents/skills/relay/SKILL.md` for workflow references (bridge, swap, debug, etc.).

## Invocation

```bash
relay <command> --output json 2>/dev/null
```

Always use `--output json` and redirect stderr. Parse stdout as JSON.

## Common Workflows

### Check request status
```bash
relay status 0x67015eb...
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
relay bridge --from base --to eth --token USDC --amount 1000000 --user 0x...
relay quote --params '{"user":"0x...","originChainId":8453,"destinationChainId":1,"originCurrency":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913","destinationCurrency":"0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48","amount":"1000000","tradeType":"EXACT_INPUT"}'
```

### Check chain health
```bash
relay chains health --fields "chains[?disabled==\`true\`].{id: id, name: name}"
```

### Discover endpoint schemas
```bash
relay schema --list
relay schema quote.v2
```

### Verify a solver address
```bash
relay chains list --fields "chains[].{id: id, name: name, solvers: solverAddresses}" | jq '.[] | select(.solvers[] == "0xTARGET...")'
```

## Rules

- Don't use `--params` with GET endpoints — use individual `--flags` instead
- Don't parse amounts as numbers — they're strings in wei and can overflow JS numbers
