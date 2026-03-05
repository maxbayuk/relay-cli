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
 * Get the latest version of an endpoint when multiple versions exist.
 * e.g., /quote and /quote/v2 → returns /quote/v2
 */
export function getLatestVersionPaths(paths: Record<string, PathItem>): Record<string, PathItem> {
  const pathKeys = Object.keys(paths)
  const result: Record<string, PathItem> = {}

  for (const p of pathKeys) {
    // Check if a newer version exists
    const versionMatch = p.match(/^(.+?)(?:\/v(\d+))?$/)
    if (!versionMatch) {
      result[p] = paths[p]
      continue
    }

    const basePath = versionMatch[1]
    const version = versionMatch[2] ? parseInt(versionMatch[2]) : 0

    // Find if there's a higher version
    const hasHigherVersion = pathKeys.some(other => {
      const otherMatch = other.match(/^(.+?)\/v(\d+)$/)
      return otherMatch && otherMatch[1] === basePath && parseInt(otherMatch[2]) > version
    })

    if (!hasHigherVersion) {
      result[p] = paths[p]
    }
  }

  return result
}
