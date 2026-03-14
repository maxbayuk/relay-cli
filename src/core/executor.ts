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

const MAX_RETRIES = 2
const RETRY_BASE_MS = 500

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Execute an HTTP request to the Relay API.
 * Retries up to 2x on 429, 5xx, timeouts, and network errors with exponential backoff.
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

  let lastError: Error | undefined

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoff = RETRY_BASE_MS * Math.pow(2, attempt - 1)
      await sleep(backoff)
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)

    let response: Response
    try {
      response = await fetch(url, {
        method: config.method,
        headers,
        body: config.body && config.method !== 'GET'
          ? JSON.stringify(config.body)
          : undefined,
        signal: controller.signal,
      })
    } catch (err: unknown) {
      clearTimeout(timeout)
      if (err instanceof Error && err.name === 'AbortError') {
        lastError = new ApiError('Request timed out after 30s', 0, null)
        continue // retry timeouts
      }
      lastError = err instanceof Error ? err : new Error(String(err))
      continue // retry network errors
    } finally {
      clearTimeout(timeout)
    }

    const timing = Date.now() - start
    const contentType = response.headers.get('content-type') || ''
    const rawText = await response.text()
    let data: unknown = null
    if (contentType.includes('application/json') || rawText.startsWith('{') || rawText.startsWith('[')) {
      try { data = JSON.parse(rawText) } catch { /* leave as null */ }
    }

    const responseHeaders: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value
    })

    if (!response.ok) {
      let errorMsg: string
      if (data && typeof data === 'object' && 'message' in data) {
        errorMsg = (data as { message: string }).message
      } else if (rawText && !data) {
        errorMsg = `HTTP ${response.status}: non-JSON response (${rawText.slice(0, 200).replace(/\s+/g, ' ')})`
      } else {
        errorMsg = `HTTP ${response.status}`
      }
      lastError = new ApiError(errorMsg, response.status, data)

      if (isRetryable(response.status) && attempt < MAX_RETRIES) {
        const retryAfter = response.headers.get('Retry-After')
        if (retryAfter) {
          const retryMs = parseInt(retryAfter, 10) * 1000
          if (!isNaN(retryMs) && retryMs > 0 && retryMs <= 30_000) {
            await sleep(retryMs)
          }
        }
        continue
      }

      throw lastError
    }

    return { status: response.status, data, headers: responseHeaders, timing }
  }

  throw lastError || new Error('Request failed after retries')
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
