import { resolveApiKey, getBaseUrl } from './auth.js'

export interface RequestConfig {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  pathParams?: Record<string, string>
  queryParams?: Record<string, string>
  body?: Record<string, unknown>
  apiKey?: string
  testnet?: boolean
}

export interface ExecutionResult {
  status: number
  data: unknown
  headers: Record<string, string>
  timing: number
}

/**
 * Build the full URL with path and query params substituted.
 */
function buildUrl(config: RequestConfig): string {
  const base = getBaseUrl(config.testnet)
  let url = config.path

  // Substitute path params: /chains/{chainId} → /chains/8453
  if (config.pathParams) {
    for (const [key, value] of Object.entries(config.pathParams)) {
      url = url.replace(`{${key}}`, encodeURIComponent(value))
    }
  }

  const fullUrl = new URL(url, base)

  // Add query params
  if (config.queryParams) {
    for (const [key, value] of Object.entries(config.queryParams)) {
      if (value !== undefined && value !== '') {
        fullUrl.searchParams.set(key, value)
      }
    }
  }

  return fullUrl.toString()
}

/**
 * Generate a curl command equivalent for --dry-run output.
 */
export function toCurl(config: RequestConfig): string {
  const url = buildUrl(config)
  const apiKey = resolveApiKey(config.apiKey)
  const parts = [`curl -X ${config.method} '${url}'`]

  if (apiKey) {
    parts.push(`  -H 'x-api-key: ${apiKey}'`)
  }

  if (config.body && config.method !== 'GET') {
    parts.push(`  -H 'Content-Type: application/json'`)
    parts.push(`  -d '${JSON.stringify(config.body)}'`)
  }

  return parts.join(' \\\n')
}

/**
 * Execute an HTTP request to the Relay API.
 */
export async function execute(config: RequestConfig): Promise<ExecutionResult> {
  const url = buildUrl(config)
  const apiKey = resolveApiKey(config.apiKey)
  const start = Date.now()

  const headers: Record<string, string> = {
    'Accept': 'application/json',
  }

  if (apiKey) {
    headers['x-api-key'] = apiKey
  }

  if (config.body && config.method !== 'GET') {
    headers['Content-Type'] = 'application/json'
  }

  const response = await fetch(url, {
    method: config.method,
    headers,
    body: config.body && config.method !== 'GET'
      ? JSON.stringify(config.body)
      : undefined,
  })

  const timing = Date.now() - start
  const data = await response.json().catch(() => null)

  const responseHeaders: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value
  })

  if (!response.ok) {
    const errorMsg = data && typeof data === 'object' && 'message' in data
      ? (data as { message: string }).message
      : `HTTP ${response.status}`
    throw new ApiError(errorMsg, response.status, data)
  }

  return { status: response.status, data, headers: responseHeaders, timing }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}
