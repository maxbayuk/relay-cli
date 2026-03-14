import { Command } from 'commander'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadSpec, getPublicPaths, getLatestVersionPaths } from './core/spec-loader.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'))
import { execute, toCurl, ApiError } from './core/executor.js'
import { formatOutput, detectFormat, type OutputFormat } from './core/formatter.js'
import { clearCache, getCacheAge } from './core/cache.js'
import { writeConfig, resolveApiKey } from './core/auth.js'
import { registerDynamicCommands } from './core/command-builder.js'
import { validateParams, formatValidationErrors } from './core/validator.js'
import { resolveChainId, resolveTokenAddress } from './core/chain-resolver.js'

/** Exit codes by error category — lets agents branch without parsing stderr. */
const EXIT = {
  OK: 0,
  VALIDATION: 2,   // bad input (address, amount, params)
  AUTH: 3,          // 401/403
  NETWORK: 4,       // connection refused, timeout
  API: 5,           // 4xx (not auth)
  RATE_LIMIT: 6,    // 429
  SERVER: 7,        // 5xx
} as const

function exitCodeForApiStatus(status: number): number {
  if (status === 429) return EXIT.RATE_LIMIT
  if (status === 401 || status === 403) return EXIT.AUTH
  if (status === 0) return EXIT.NETWORK  // timeout
  if (status >= 500) return EXIT.SERVER
  if (status >= 400) return EXIT.API
  return EXIT.API
}

const program = new Command()

program
  .name('relay')
  .description('AI-native CLI for Relay Protocol API — dynamically built from OpenAPI spec')
  .version(pkg.version)
  .option('--api-key <key>', 'API key (overrides env/config)')
  .option('--testnet', 'Use testnet API (api.testnets.relay.link)')
  .option('--output <format>', 'Output format: json, table, minimal')
  .option('--fields <expression>', 'JMESPath expression to filter response fields')
  .option('--preset <name>', 'Use a built-in field preset (e.g., chains-slim, chains-health)')
  .option('--dry-run', 'Show the request without executing it')
  .option('--refresh-cache', 'Force refresh cached data')
  .option('--no-pretty', 'Disable JSON pretty printing')

// --- Smart aliases (before dynamic commands so they take priority) ---

// status <requestId> — quick status lookup
program
  .command('status <requestId>')
  .description('Quick status lookup for a request (alias for requests list --id)')
  .action(async (requestId) => {
    const opts = program.opts()
    await executeEndpoint('GET', '/requests/v2', { id: requestId }, opts)
  })

// tx <requestId> — generate relay.link URL
program
  .command('tx <requestId>')
  .description('Print the relay.link transaction URL')
  .action((requestId) => {
    const opts = program.opts()
    const format = detectFormat(opts.output as OutputFormat)
    const url = `https://relay.link/transaction/${requestId}`
    if (format === 'json') {
      console.log(JSON.stringify({ url, requestId }))
    } else {
      console.log(url)
    }
  })

// --- smart quote alias ---
// relay bridge --from base --to eth --token USDC --amount 100 --user 0x...
program
  .command('bridge')
  .description('Quick cross-chain quote (resolves chain names and token symbols)')
  .requiredOption('--from <chain>', 'Origin chain (name, alias, or ID)')
  .requiredOption('--to <chain>', 'Destination chain (name, alias, or ID)')
  .requiredOption('--token <symbol>', 'Token symbol (USDC, USDT, ETH)')
  .requiredOption('--amount <value>', 'Amount in smallest unit (wei)')
  .requiredOption('--user <address>', 'User wallet address')
  .option('--tradeType <type>', 'EXACT_INPUT or EXACT_OUTPUT', 'EXACT_INPUT')
  .action(async (cmdOpts) => {
    const opts = program.opts()
    try {
      const originChainId = await resolveChainId(cmdOpts.from)
      const destinationChainId = await resolveChainId(cmdOpts.to)

      const originCurrency = resolveTokenAddress(cmdOpts.token, originChainId)
      const destinationCurrency = resolveTokenAddress(cmdOpts.token, destinationChainId)

      if (!originCurrency) {
        console.error(`Unknown token "${cmdOpts.token}" on chain ${originChainId}. Use a contract address with relay quote --params instead.`)
        process.exit(EXIT.VALIDATION)
      }
      if (!destinationCurrency) {
        console.error(`Unknown token "${cmdOpts.token}" on chain ${destinationChainId}. Use a contract address with relay quote --params instead.`)
        process.exit(EXIT.VALIDATION)
      }

      const body = {
        user: cmdOpts.user,
        originChainId,
        destinationChainId,
        originCurrency,
        destinationCurrency,
        amount: cmdOpts.amount,
        tradeType: cmdOpts.tradeType,
      }

      await executeEndpoint('POST', '/quote/v2', {}, opts, body)
    } catch (err) {
      console.error(err instanceof Error ? err.message : err)
      process.exit(err instanceof ApiError ? exitCodeForApiStatus(err.status) : EXIT.API)
    }
  })

// --- schema command ---
program
  .command('schema [endpoint]')
  .description('Inspect API endpoint schemas (e.g., relay schema chains, relay schema quote.v2)')
  .option('--list', 'List all available endpoints')
  .action(async (endpoint, cmdOpts) => {
    const opts = program.opts()
    const spec = await loadSpec(opts.refreshCache)
    const allPublicPaths = getLatestVersionPaths(getPublicPaths(spec))

    // Filter out dangerous endpoints (same as command-builder.ts parseEndpoints filter)
    const publicPaths: Record<string, any> = {}
    for (const [path, item] of Object.entries(allPublicPaths)) {
      if (path.startsWith('/execute')) continue
      if (path.includes('/fast-fill')) continue
      // Block POST on app-fees (claim), keep GETs (balances, claims list)
      if (path.includes('/app-fees')) {
        const safeItem: Record<string, any> = {}
        for (const [method, op] of Object.entries(item as Record<string, any>)) {
          if (method === 'post') continue
          safeItem[method] = op
        }
        if (Object.keys(safeItem).length > 0) {
          publicPaths[path] = safeItem
        }
        continue
      }
      publicPaths[path] = item
    }

    if (cmdOpts.list || !endpoint) {
      // List all endpoints
      const rows = Object.entries(publicPaths).flatMap(([path, item]) => {
        return Object.entries(item as Record<string, any>)
          .filter(([method]) => ['get', 'post', 'put', 'delete'].includes(method))
          .map(([method, op]) => ({
            method: method.toUpperCase(),
            path,
            description: (op as any)?.summary || (op as any)?.description || '',
            deprecated: (op as any)?.deprecated ? 'yes' : '',
          }))
      })

      const format = detectFormat(opts.output as OutputFormat)
      console.log(formatOutput(rows, { format, fields: opts.fields, preset: opts.preset }))
      return
    }

    // Find matching endpoint
    const normalized = endpoint.replace(/\./g, '/')
    const matchPath = normalized.startsWith('/') ? normalized : `/${normalized}`

    // Try exact match first, then fuzzy
    let matched: [string, any] | undefined
    for (const [path, item] of Object.entries(publicPaths)) {
      if (path === matchPath || path.replace(/\/v\d+$/, '') === matchPath) {
        matched = [path, item]
        break
      }
    }

    if (!matched) {
      // Fuzzy: find paths containing the search term
      const candidates = Object.entries(publicPaths).filter(([path]) =>
        path.toLowerCase().includes(normalized.toLowerCase())
      )
      if (candidates.length === 1) {
        matched = candidates[0]
      } else if (candidates.length > 1) {
        console.error(`Multiple matches for "${endpoint}":`)
        candidates.forEach(([p]) => console.error(`  ${p}`))
        process.exit(EXIT.VALIDATION)
      }
    }

    if (!matched) {
      console.error(`No endpoint found matching "${endpoint}". Use --list to see all endpoints.`)
      process.exit(EXIT.VALIDATION)
    }

    const [path, pathItem] = matched
    const output: Record<string, unknown> = { path }

    for (const [method, op] of Object.entries(pathItem)) {
      if (!['get', 'post', 'put', 'delete'].includes(method)) continue
      const operation = op as any

      const methodInfo: Record<string, unknown> = {
        method: method.toUpperCase(),
        summary: operation.summary,
        deprecated: operation.deprecated || false,
      }

      // Parameters
      if (operation.parameters?.length) {
        methodInfo.parameters = operation.parameters.map((p: any) => ({
          name: p.name,
          in: p.in,
          required: p.required || false,
          type: p.schema?.type,
          description: p.description,
        }))
      }

      // Request body schema
      if (operation.requestBody?.content?.['application/json']?.schema) {
        const schema = operation.requestBody.content['application/json'].schema
        methodInfo.requestBody = summarizeSchema(schema)
      }

      // Response schema
      const successResponse = operation.responses?.['200'] || operation.responses?.['201']
      if (successResponse?.content?.['application/json']?.schema) {
        methodInfo.responseSchema = summarizeSchema(successResponse.content['application/json'].schema)
      }

      output[method] = methodInfo
    }

    const format = detectFormat(opts.output as OutputFormat)
    console.log(formatOutput(output, { format, fields: opts.fields, preset: opts.preset, pretty: opts.pretty }))
  })

// --- config command ---
const configCmd = program
  .command('config')
  .description('Manage CLI configuration')

configCmd
  .command('set <key> <value>')
  .description('Set a config value (e.g., relay config set apiKey <key>)')
  .action((key, value) => {
    const opts = program.opts()
    const format = detectFormat(opts.output as OutputFormat)
    writeConfig({ [key]: value })
    if (format === 'json') {
      console.log(JSON.stringify({ success: true, key, file: '~/.relay-cli/config.json' }))
    } else {
      console.log(`Set ${key} in ~/.relay-cli/config.json`)
    }
  })

// --- cache command ---
program
  .command('cache')
  .description('Manage cached data')
  .option('--clear', 'Clear all cached data')
  .option('--info', 'Show cache status')
  .action((cmdOpts) => {
    const opts = program.opts()
    const format = detectFormat(opts.output as OutputFormat)
    if (cmdOpts.clear) {
      clearCache()
      if (format === 'json') {
        console.log(JSON.stringify({ success: true, action: 'cache_cleared' }))
      } else {
        console.log('Cache cleared.')
      }
      return
    }
    // Show cache info
    const specAge = getCacheAge('openapi-spec')
    const chainsAge = getCacheAge('chains')
    console.log(JSON.stringify({
      spec: specAge !== null ? { ageMs: specAge, ageHours: Math.round(specAge / 3600000 * 10) / 10 } : null,
      chains: chainsAge !== null ? { ageMs: chainsAge, ageHours: Math.round(chainsAge / 3600000 * 10) / 10 } : null,
    }, null, 2))
  })

// --- Dynamic command registration from OpenAPI spec ---
async function registerFromSpec() {
  try {
    const opts = program.opts()
    const spec = await loadSpec(opts.refreshCache)

    registerDynamicCommands(program, spec, executeEndpoint)
  } catch (err) {
    // Spec loading failed — warn since the command likely needs it
    console.error(`Warning: Could not load API spec. Some commands may be unavailable.`)
    console.error(`  ${err instanceof Error ? err.message : err}`)
    console.error(`  Use 'relay cache --clear' and try again.\n`)
  }
}

// --- Helper functions ---

async function executeEndpoint(
  method: string,
  path: string,
  queryParams: Record<string, string>,
  opts: Record<string, any>,
  body?: Record<string, unknown>,
  pathParams?: Record<string, string>,
) {
  // Validate inputs before making the request (query, path, and body params)
  const bodyStringParams: Record<string, string> = {}
  if (body) {
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === 'string' || typeof value === 'number') {
        bodyStringParams[key] = String(value)
      }
    }
  }
  const allParams = { ...queryParams, ...(pathParams || {}), ...bodyStringParams }
  const validationErrors = validateParams(allParams)
  if (validationErrors.length > 0) {
    console.error('Validation errors:')
    console.error(formatValidationErrors(validationErrors))
    process.exit(EXIT.VALIDATION)
  }

  const config = {
    method: method as 'GET' | 'POST' | 'PUT' | 'DELETE',
    path,
    pathParams,
    queryParams,
    body,
    apiKey: opts.apiKey,
    testnet: opts.testnet,
  }

  if (opts.dryRun) {
    const format = detectFormat(opts.output as OutputFormat)
    const curl = toCurl(config)
    if (format === 'json') {
      console.log(JSON.stringify({ dryRun: true, curl, config }))
    } else {
      console.log(curl)
    }
    return
  }

  try {
    const result = await execute(config)
    const format = detectFormat(opts.output as OutputFormat)
    const output = formatOutput(result.data, {
      format,
      fields: opts.fields,
      preset: opts.preset,
      pretty: opts.pretty,
    })
    console.log(output)
  } catch (err) {
    if (err instanceof ApiError) {
      console.error(`API Error (${err.status}): ${err.message}`)
      if (err.data) {
        console.error(JSON.stringify(err.data, null, 2))
      }
      process.exit(exitCodeForApiStatus(err.status))
    }
    throw err
  }
}

function summarizeSchema(schema: any, depth = 0): any {
  if (depth > 4) return { type: schema.type || 'object', note: '(truncated)' }

  if (schema.type === 'array') {
    return {
      type: 'array',
      items: schema.items ? summarizeSchema(schema.items, depth + 1) : 'unknown',
    }
  }

  if (schema.type === 'object' || schema.properties) {
    const props: Record<string, any> = {}
    for (const [key, val] of Object.entries(schema.properties || {})) {
      const prop = val as any
      props[key] = {
        type: prop.type || (prop.properties ? 'object' : 'unknown'),
        required: schema.required?.includes(key) || false,
        ...(prop.description && { description: prop.description }),
        ...(prop.enum && { enum: prop.enum }),
        ...(prop.default !== undefined && { default: prop.default }),
        ...((prop.type === 'object' || prop.properties) && { properties: summarizeSchema(prop, depth + 1).properties }),
        ...(prop.type === 'array' && { items: summarizeSchema(prop, depth + 1).items }),
      }
    }
    return { type: 'object', properties: props }
  }

  return {
    type: schema.type || 'unknown',
    ...(schema.enum && { enum: schema.enum }),
    ...(schema.description && { description: schema.description }),
    ...(schema.format && { format: schema.format }),
  }
}

// Skip spec loading for commands that don't need it
const firstArg = process.argv[2]
const offlineCommands = ['cache', 'config', 'tx', '--help', '-h', '--version', '-V']
if (!firstArg || !offlineCommands.includes(firstArg)) {
  await registerFromSpec()
}
program.parse()
