import { readCache, writeCache } from './cache.js'
import { getBaseUrl } from './auth.js'

const SPEC_CACHE_KEY = 'openapi-spec'
const SPEC_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

export interface OpenApiSpec {
  openapi: string
  info: { title: string; version: string }
  paths: Record<string, PathItem>
}

export interface PathItem {
  [method: string]: OperationObject | undefined
  get?: OperationObject
  post?: OperationObject
  put?: OperationObject
  delete?: OperationObject
}

export interface OperationObject {
  summary?: string
  description?: string
  deprecated?: boolean
  parameters?: ParameterObject[]
  requestBody?: {
    content?: {
      'application/json'?: {
        schema?: SchemaObject
      }
    }
  }
  responses?: Record<string, {
    description?: string
    content?: {
      'application/json'?: {
        schema?: SchemaObject
      }
    }
  }>
}

export interface ParameterObject {
  name: string
  in: 'query' | 'path' | 'header'
  required?: boolean
  description?: string
  schema?: SchemaObject
}

export interface SchemaObject {
  type?: string
  properties?: Record<string, SchemaObject>
  items?: SchemaObject
  required?: string[]
  enum?: string[]
  description?: string
  format?: string
  default?: unknown
}

/**
 * Load the OpenAPI spec, using cache when available.
 */
export async function loadSpec(forceRefresh = false): Promise<OpenApiSpec> {
  if (!forceRefresh) {
    const cached = readCache<OpenApiSpec>(SPEC_CACHE_KEY)
    if (cached) return cached
  }

  const url = `${getBaseUrl()}/documentation/json`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch OpenAPI spec: ${response.status} ${response.statusText}`)
  }

  const spec: OpenApiSpec = await response.json() as OpenApiSpec
  writeCache(SPEC_CACHE_KEY, spec, SPEC_TTL_MS)
  return spec
}

/**
 * Get public API paths, filtering out admin/internal endpoints.
 */
export function getPublicPaths(spec: OpenApiSpec): Record<string, PathItem> {
  const filtered: Record<string, PathItem> = {}
  const excludePatterns = [
    '/admin',
    '/lives',
    '/loadforge',
    '/conduit',
    '/provision',
    '/wallets/screen',
    '/sanctioned',
  ]

  for (const [path, item] of Object.entries(spec.paths)) {
    if (excludePatterns.some(p => path.includes(p))) continue
    filtered[path] = item
  }

  return filtered
}

/**
 * Whether an operation hard-requires an API key (x-api-key marked required in the spec).
 * Endpoints that merely accept an optional x-api-key header are not gated.
 */
export function operationRequiresApiKey(operation: OperationObject): boolean {
  return (operation.parameters || []).some(
    p => p.in === 'header' && p.name === 'x-api-key' && p.required === true,
  )
}

/**
 * Whether every operation on a path hard-requires an API key.
 */
export function pathRequiresApiKey(item: PathItem): boolean {
  const ops = ['get', 'post', 'put', 'delete']
    .map(m => item[m])
    .filter((op): op is OperationObject => !!op)
  return ops.length > 0 && ops.every(operationRequiresApiKey)
}

/**
 * Get the latest version of an endpoint when multiple versions exist.
 * e.g., /quote and /quote/v2 → returns /quote/v2
 *
 * A keyless invocation must never be silently routed to a version that
 * hard-requires x-api-key (e.g. /requests/v3 superseding the public
 * /requests/v2): without a key, gated versions are skipped in favor of the
 * latest callable one. If every version is gated, the latest is kept and the
 * missing-key error is surfaced at invocation time instead.
 */
export function getLatestVersionPaths(
  paths: Record<string, PathItem>,
  hasApiKey = true,
): Record<string, PathItem> {
  const groups = new Map<string, Array<{ path: string; version: number }>>()

  for (const p of Object.keys(paths)) {
    const versionMatch = p.match(/^(.+?)(?:\/v(\d+))?$/)
    const basePath = versionMatch?.[1] ?? p
    const version = versionMatch?.[2] ? parseInt(versionMatch[2]) : 0
    if (!groups.has(basePath)) groups.set(basePath, [])
    groups.get(basePath)!.push({ path: p, version })
  }

  const result: Record<string, PathItem> = {}
  for (const versions of groups.values()) {
    versions.sort((a, b) => b.version - a.version)
    const callable = hasApiKey
      ? versions
      : versions.filter(v => !pathRequiresApiKey(paths[v.path]))
    const chosen = callable[0] ?? versions[0]
    result[chosen.path] = paths[chosen.path]
  }

  return result
}
