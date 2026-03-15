/**
 * Unit tests for output formatting and JMESPath field filtering.
 */

import { describe, it, expect } from 'vitest'
import { applyFieldFilter, formatOutput, detectFormat } from '../src/core/formatter.js'

describe('applyFieldFilter', () => {
  const sampleChains = {
    chains: [
      { id: 1, name: 'ethereum', displayName: 'Ethereum', disabled: false },
      { id: 8453, name: 'base', displayName: 'Base', disabled: false },
      { id: 10, name: 'optimism', displayName: 'Optimism', disabled: true },
    ],
  }

  it('returns full data when no filter', () => {
    expect(applyFieldFilter(sampleChains)).toEqual(sampleChains)
  })

  it('filters with JMESPath expression', () => {
    const result = applyFieldFilter(sampleChains, 'chains[].{id: id, name: name}')
    expect(result).toEqual([
      { id: 1, name: 'ethereum' },
      { id: 8453, name: 'base' },
      { id: 10, name: 'optimism' },
    ])
  })

  it('filters with JMESPath condition', () => {
    const result = applyFieldFilter(sampleChains, 'chains[?disabled==`true`].name')
    expect(result).toEqual(['optimism'])
  })

  it('applies built-in chains-ids preset', () => {
    const result = applyFieldFilter(sampleChains, undefined, 'chains-ids')
    expect(result).toEqual([
      { id: 1, name: 'ethereum' },
      { id: 8453, name: 'base' },
      { id: 10, name: 'optimism' },
    ])
  })

  it('applies chains-health preset', () => {
    const result = applyFieldFilter(sampleChains, undefined, 'chains-health') as any[]
    expect(result[0]).toHaveProperty('id')
    expect(result[0]).toHaveProperty('name')
    expect(result[0]).toHaveProperty('disabled')
  })

  it('throws on invalid JMESPath', () => {
    expect(() => applyFieldFilter(sampleChains, '[[invalid')).toThrow('Invalid JMESPath')
  })

  it('returns null for unknown preset (no matching expression)', () => {
    // Unknown preset returns undefined expression, so full data is returned
    const result = applyFieldFilter(sampleChains, undefined, 'nonexistent-preset')
    expect(result).toEqual(sampleChains)
  })
})

describe('formatOutput', () => {
  it('formats as JSON with indentation', () => {
    const output = formatOutput({ a: 1 }, { format: 'json' })
    expect(output).toBe('{\n  "a": 1\n}')
  })

  it('formats as compact JSON when pretty=false', () => {
    const output = formatOutput({ a: 1 }, { format: 'json', pretty: false })
    expect(output).toBe('{"a":1}')
  })

  it('formats array as minimal (tab-separated)', () => {
    const data = [{ id: 1, name: 'eth' }, { id: 10, name: 'op' }]
    const output = formatOutput(data, { format: 'minimal' })
    expect(output).toContain('1\teth')
    expect(output).toContain('10\top')
  })

  it('formats array as table with headers', () => {
    const data = [{ id: 1, name: 'ethereum' }]
    const output = formatOutput(data, { format: 'table' })
    expect(output).toContain('id')
    expect(output).toContain('name')
    expect(output).toContain('ethereum')
    expect(output).toContain('─') // separator
  })

  it('applies fields filter before formatting', () => {
    const data = { chains: [{ id: 1, name: 'eth', extra: 'stuff' }] }
    const output = formatOutput(data, { format: 'json', fields: 'chains[].{id: id}' })
    const parsed = JSON.parse(output)
    expect(parsed).toEqual([{ id: 1 }])
  })
})

describe('detectFormat', () => {
  it('returns explicit format when provided', () => {
    expect(detectFormat('json')).toBe('json')
    expect(detectFormat('table')).toBe('table')
    expect(detectFormat('minimal')).toBe('minimal')
  })

  // Auto-detection depends on process.stdout.isTTY which varies in test env
  it('returns a valid format when no explicit format', () => {
    const format = detectFormat()
    expect(['json', 'table']).toContain(format)
  })
})
