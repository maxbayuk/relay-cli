import { describe, it, expect } from 'vitest'
import {
  getLatestVersionPaths,
  operationRequiresApiKey,
  pathRequiresApiKey,
  type PathItem,
  type OperationObject,
} from '../src/core/spec-loader.js'
import { parseEndpoints } from '../src/core/command-builder.js'

function op(params: Array<{ name: string; in: 'query' | 'header'; required?: boolean }> = []): OperationObject {
  return { parameters: params.map(p => ({ ...p })) }
}

const openOp = op([{ name: 'limit', in: 'query' }])
const optionalKeyOp = op([
  { name: 'limit', in: 'query' },
  { name: 'x-api-key', in: 'header' },
])
const gatedOp = op([
  { name: 'limit', in: 'query' },
  { name: 'x-api-key', in: 'header', required: true },
])

describe('operationRequiresApiKey', () => {
  it('false when x-api-key is absent', () => {
    expect(operationRequiresApiKey(openOp)).toBe(false)
  })

  it('false when x-api-key is an optional header', () => {
    expect(operationRequiresApiKey(optionalKeyOp)).toBe(false)
  })

  it('true only when x-api-key is a required header', () => {
    expect(operationRequiresApiKey(gatedOp)).toBe(true)
  })
})

describe('pathRequiresApiKey', () => {
  it('true when every operation is gated', () => {
    expect(pathRequiresApiKey({ get: gatedOp })).toBe(true)
  })

  it('false when any operation is callable keyless', () => {
    expect(pathRequiresApiKey({ get: gatedOp, post: openOp })).toBe(false)
  })

  it('false for a path with no operations', () => {
    expect(pathRequiresApiKey({})).toBe(false)
  })
})

describe('getLatestVersionPaths', () => {
  // Mirrors the live API: /requests (v0) and /requests/v2 are open,
  // /requests/v3 requires x-api-key.
  const requestsFamily: Record<string, PathItem> = {
    '/requests': { get: openOp },
    '/requests/v2': { get: optionalKeyOp },
    '/requests/v3': { get: gatedOp },
  }

  it('keyed: picks the latest version even when gated', () => {
    const result = getLatestVersionPaths(requestsFamily, true)
    expect(Object.keys(result)).toEqual(['/requests/v3'])
  })

  it('keyless: skips gated versions in favor of the latest callable one', () => {
    const result = getLatestVersionPaths(requestsFamily, false)
    expect(Object.keys(result)).toEqual(['/requests/v2'])
  })

  it('defaults to keyed behavior (latest version)', () => {
    const result = getLatestVersionPaths(requestsFamily)
    expect(Object.keys(result)).toEqual(['/requests/v3'])
  })

  it('keyless: keeps the latest version when every version is gated', () => {
    const allGated: Record<string, PathItem> = {
      '/private': { get: gatedOp },
      '/private/v2': { get: gatedOp },
    }
    const result = getLatestVersionPaths(allGated, false)
    expect(Object.keys(result)).toEqual(['/private/v2'])
  })

  it('keyless: ungated latest version is still preferred', () => {
    const open: Record<string, PathItem> = {
      '/quote': { post: openOp },
      '/quote/v2': { post: openOp },
    }
    const result = getLatestVersionPaths(open, false)
    expect(Object.keys(result)).toEqual(['/quote/v2'])
  })

  it('groups by full base path, not path prefix', () => {
    const mixed: Record<string, PathItem> = {
      '/requests/v2': { get: openOp },
      '/requests/metadata': { post: openOp },
      '/requests/{requestId}/signature': { get: openOp },
      '/requests/{requestId}/signature/v2': { get: openOp },
    }
    const result = getLatestVersionPaths(mixed, false)
    expect(Object.keys(result).sort()).toEqual([
      '/requests/metadata',
      '/requests/v2',
      '/requests/{requestId}/signature/v2',
    ])
  })
})

describe('parseEndpoints auth surface', () => {
  const spec = {
    openapi: '3.0.0',
    info: { title: 'test', version: '1' },
    paths: {
      '/requests': { get: openOp },
      '/requests/v2': { get: optionalKeyOp },
      '/requests/v3': { get: gatedOp },
      '/chains': { get: openOp },
    },
  }

  it('keyed: selects v3 and marks it as requiring auth', () => {
    const endpoints = parseEndpoints(spec, true)
    const requests = endpoints.find(e => e.path.startsWith('/requests'))
    expect(requests?.path).toBe('/requests/v3')
    expect(requests?.requiresAuth).toBe(true)
  })

  it('keyless: selects v2 and does not treat the optional header as auth', () => {
    const endpoints = parseEndpoints(spec, false)
    const requests = endpoints.find(e => e.path.startsWith('/requests'))
    expect(requests?.path).toBe('/requests/v2')
    expect(requests?.requiresAuth).toBe(false)
  })
})
