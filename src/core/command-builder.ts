/**
 * Dynamic command generation from OpenAPI spec.
 * Converts OpenAPI paths → commander commands at runtime.
 *
 * Path structure → command hierarchy:
 *   /chains              → relay chains
 *   /chains/health       → relay chains health
 *   /chains/liquidity    → relay chains liquidity
 *   /quote/v2            → relay quote
 *   /requests/v2         → relay requests list
 *   /chains/{chainId}/currencies/{address} → relay chains currencies --chainId --address
 */

import { Command } from 'commander'
import type { OpenApiSpec, PathItem, OperationObject, ParameterObject } from './spec-loader.js'
import { getPublicPaths, getLatestVersionPaths } from './spec-loader.js'

export interface EndpointInfo {
  path: string
  method: string
  operation: OperationObject
  pathParams: ParameterObject[]
  queryParams: ParameterObject[]
  hasBody: boolean
  requiresAuth: boolean
  commandParts: string[]  // e.g. ['chains', 'health'] or ['requests', 'list']
}

/**
 * Parse all public endpoints from the spec into EndpointInfo objects.
 * `hasApiKey` selects the version surface: keyless invocations must not be
 * routed to versions that hard-require x-api-key (see getLatestVersionPaths).
 */
export function parseEndpoints(spec: OpenApiSpec, hasApiKey = true): EndpointInfo[] {
  const publicPaths = getPublicPaths(spec)
  const latestPaths = getLatestVersionPaths(publicPaths, hasApiKey)
  const endpoints: EndpointInfo[] = []

  // Execution endpoints removed — CLI is read-only (quoting, tracking, discovery)
  const SKIP_PATHS = ['/execute', '/fast-fill']

  for (const [path, item] of Object.entries(latestPaths)) {
    // Skip execution endpoints
    if (SKIP_PATHS.some(p => path.startsWith(p))) continue
    // Skip app-fees claim (but keep balances and claims history)
    if (path.includes('/claim') && !path.includes('/claims')) continue

    const methods = ['get', 'post', 'put', 'delete']
    for (const method of methods) {
      const operation = (item as any)[method] as OperationObject | undefined
      if (!operation) continue

      const allParams = operation.parameters || []
      const pathParams = allParams.filter(p => p.in === 'path')
      const queryParams = allParams.filter(p => p.in === 'query')
      const hasBody = !!operation.requestBody
      // Only a REQUIRED x-api-key header gates a command; optional headers don't.
      const requiresAuth = allParams.some(
        p => p.in === 'header' && p.name === 'x-api-key' && p.required === true,
      )
      const commandParts = pathToCommandParts(path)

      endpoints.push({
        path,
        method: method.toUpperCase(),
        operation,
        pathParams,
        queryParams,
        hasBody,
        requiresAuth,
        commandParts,
      })
    }
  }

  return endpoints
}

/**
 * Convert an API path to command parts.
 *
 * /chains → ['chains']
 * /chains/health → ['chains', 'health']
 * /quote/v2 → ['quote']
 * /currencies/token/price/v2 → ['currencies', 'token-price']
 * /chains/{chainId}/currencies/{address} → ['chains', 'currency-info']
 * /requests/{requestId}/signature/v2 → ['requests', 'signature']
 */
function pathToCommandParts(path: string): string[] {
  // Remove version suffix
  const clean = path.replace(/\/v\d+$/, '')

  // Split and filter out path params and empty segments
  const segments = clean.split('/').filter(s => s && !s.startsWith('{'))

  if (segments.length === 0) return ['root']

  // Special cases for better command naming
  const pathKey = segments.join('/')

  const COMMAND_MAP: Record<string, string[]> = {
    'chains': ['chains', 'list'],
    'chains/health': ['chains', 'health'],
    'chains/liquidity': ['chains', 'liquidity'],
    'config': ['config', 'get'],
    'quote': ['quote'],
    'price': ['price'],
    'requests': ['requests', 'list'],
    'requests/metadata': ['requests', 'metadata'],
    'intents/status': ['intents', 'status'],
    'currencies': ['currencies', 'search'],
    'currencies/token/price': ['currencies', 'price'],
    'currencies/trending': ['currencies', 'trending'],
    'swap-sources': ['swap-sources'],
    'prices/rates': ['prices', 'rates'],
    'transactions/index': ['transactions', 'index'],
    'transactions/single': ['transactions', 'single'],
    'app-fees': ['app-fees', 'balances'],
  }

  // Check path for app-fees patterns
  if (pathKey.startsWith('app-fees')) {
    if (pathKey.includes('claims')) return ['app-fees', 'claims']
    return ['app-fees', 'balances']
  }

  // Check chains sub-paths with path params
  if (pathKey.startsWith('chains') && pathKey.includes('currencies')) {
    if (pathKey.includes('chart')) return ['currencies', 'chart']
    return ['currencies', 'info']
  }

  // Requests sub-paths with path params
  if (pathKey.startsWith('requests') && pathKey.includes('signature')) {
    return ['requests', 'signature']
  }

  if (COMMAND_MAP[pathKey]) return COMMAND_MAP[pathKey]

  // Fallback: use segments as-is, joining deep paths with hyphens
  if (segments.length > 2) {
    return [segments[0], segments.slice(1).join('-')]
  }

  return segments
}

/**
 * Build a description for an endpoint command.
 */
function buildDescription(info: EndpointInfo): string {
  if (info.operation.summary) return info.operation.summary
  if (info.operation.description) return info.operation.description.substring(0, 100)

  // Generate from path and method
  const verb = info.method === 'GET' ? 'Get' : info.method === 'POST' ? 'Submit' : info.method
  const resource = info.path.replace(/\/v\d+$/, '').replace(/\{[^}]+\}/g, '').replace(/\/\//g, '/').replace(/\/$/, '')
  return `${verb} ${resource}`
}

/**
 * Generate a camelCase option name from a parameter name.
 */
function toOptionFlag(param: ParameterObject): string {
  const name = param.name
  const flag = param.required
    ? `--${name} <${param.schema?.type || 'value'}>`
    : `--${name} [${param.schema?.type || 'value'}]`
  return flag
}

/**
 * Register all dynamically generated commands on a commander program.
 * Returns the list of endpoint infos for reference.
 */
export function registerDynamicCommands(
  program: Command,
  spec: OpenApiSpec,
  executeEndpoint: (
    method: string,
    path: string,
    queryParams: Record<string, string>,
    opts: Record<string, any>,
    body?: Record<string, unknown>,
    pathParams?: Record<string, string>,
    requiresAuth?: boolean,
  ) => Promise<void>,
  hasApiKey = true,
): EndpointInfo[] {
  const endpoints = parseEndpoints(spec, hasApiKey)

  // Group endpoints by their first command part (top-level group)
  const groups = new Map<string, EndpointInfo[]>()
  for (const ep of endpoints) {
    const group = ep.commandParts[0]
    if (!groups.has(group)) groups.set(group, [])
    groups.get(group)!.push(ep)
  }

  // Track created subcommand groups
  const subcommands = new Map<string, Command>()

  for (const [groupName, groupEndpoints] of groups) {
    // Single-command groups (e.g., 'quote', 'price')
    if (groupEndpoints.length === 1 && groupEndpoints[0].commandParts.length === 1) {
      const ep = groupEndpoints[0]
      registerEndpointCommand(program, ep, executeEndpoint)
      continue
    }

    // Multi-command groups (e.g., 'chains list', 'chains health')
    let groupCmd = subcommands.get(groupName)
    if (!groupCmd) {
      // Check if program already has this command (from hardcoded commands)
      const existing = program.commands.find(c => c.name() === groupName)
      if (existing) {
        groupCmd = existing
      } else {
        groupCmd = program.command(groupName).description(`${groupName} commands`)
      }
      subcommands.set(groupName, groupCmd)
    }

    for (const ep of groupEndpoints) {
      const subName = ep.commandParts.length > 1 ? ep.commandParts.slice(1).join('-') : 'default'

      // Skip if this subcommand already exists
      if (groupCmd.commands.find(c => c.name() === subName)) continue

      registerEndpointCommand(groupCmd, ep, executeEndpoint, subName)
    }
  }

  return endpoints
}

/**
 * Register a single endpoint as a commander command.
 */
function registerEndpointCommand(
  parent: Command,
  ep: EndpointInfo,
  executeEndpoint: (
    method: string,
    path: string,
    queryParams: Record<string, string>,
    opts: Record<string, any>,
    body?: Record<string, unknown>,
    pathParams?: Record<string, string>,
    requiresAuth?: boolean,
  ) => Promise<void>,
  commandName?: string,
): void {
  const name = commandName || ep.commandParts[ep.commandParts.length - 1]
  const description = buildDescription(ep)

  const cmd = parent.command(name).description(`[${ep.method}] ${description}`)

  // Add --params for POST endpoints (agent-friendly raw JSON)
  if (ep.hasBody) {
    cmd.option('--params <json>', 'Raw JSON request body')
  }

  // Add path params as required options
  for (const param of ep.pathParams) {
    cmd.requiredOption(
      toOptionFlag({ ...param, required: true }),
      param.description || `${param.name} (path parameter)`,
    )
  }

  // Add query params as options
  for (const param of ep.queryParams) {
    if (param.in === 'header') continue // Skip header params (like x-api-key)
    if (param.required) {
      cmd.requiredOption(toOptionFlag(param), param.description || param.name)
    } else {
      cmd.option(toOptionFlag(param), param.description || param.name)
    }
  }

  cmd.action(async (cmdOpts: Record<string, any>) => {
    const globalOpts = parent.parent ? parent.parent.opts() : parent.opts()

    // Build path params
    const pathParams: Record<string, string> = {}
    for (const param of ep.pathParams) {
      if (cmdOpts[param.name]) {
        pathParams[param.name] = cmdOpts[param.name]
      }
    }

    // Build query params
    const queryParams: Record<string, string> = {}
    for (const param of ep.queryParams) {
      if (param.in === 'header') continue
      if (cmdOpts[param.name] !== undefined) {
        queryParams[param.name] = String(cmdOpts[param.name])
      }
    }

    // Build request body
    let body: Record<string, unknown> | undefined
    if (ep.hasBody && cmdOpts.params) {
      try {
        body = JSON.parse(cmdOpts.params)
      } catch {
        console.error('Error: --params must be valid JSON')
        process.exit(1)
      }
    }

    await executeEndpoint(ep.method, ep.path, queryParams, globalOpts, body, pathParams, ep.requiresAuth)
  })
}

/**
 * Get a flat list of all available commands for help/discovery.
 */
export function listCommands(endpoints: EndpointInfo[]): Array<{
  command: string
  method: string
  path: string
  description: string
  params: string[]
}> {
  return endpoints.map(ep => ({
    command: `relay ${ep.commandParts.join(' ')}`,
    method: ep.method,
    path: ep.path,
    description: buildDescription(ep),
    params: [
      ...ep.pathParams.map(p => `--${p.name} (required, path)`),
      ...ep.queryParams.filter(p => p.in !== 'header').map(p =>
        `--${p.name}${p.required ? ' (required)' : ''}`
      ),
      ...(ep.hasBody ? ['--params <json>'] : []),
    ],
  }))
}
