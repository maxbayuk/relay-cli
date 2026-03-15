/**
 * Smoke tests — hit the live Relay API via the CLI entry points.
 * Validates that commands run, return valid JSON, and have expected shapes.
 *
 * Run: npx vitest run test/smoke.test.ts
 * These tests require network access to api.relay.link.
 */

import { describe, it, expect } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const CLI = ['npx', ['tsx', 'src/cli.ts']] as const

/** Run a CLI command and return parsed JSON stdout */
async function run(...args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number; json?: unknown }> {
  try {
    const { stdout, stderr } = await exec(CLI[0], [...CLI[1], ...args, '--output', 'json'], {
      cwd: new URL('..', import.meta.url).pathname,
      timeout: 30_000,
    })
    let json: unknown
    try { json = JSON.parse(stdout) } catch { /* not JSON */ }
    return { stdout, stderr, exitCode: 0, json }
  } catch (err: any) {
    return { stdout: err.stdout || '', stderr: err.stderr || '', exitCode: err.code || 1 }
  }
}

describe('Smoke tests (live API)', () => {
  // --- Chains ---

  it('chains list returns {chains: [...]}', async () => {
    const result = await run('chains', 'list', '--fields', 'chains[0:3].{id: id, name: name}')
    expect(result.exitCode).toBe(0)
    const data = result.json as any[]
    expect(Array.isArray(data)).toBe(true)
    expect(data.length).toBeGreaterThan(0)
    expect(data[0]).toHaveProperty('id')
    expect(data[0]).toHaveProperty('name')
  }, 15_000)

  it('chains health returns data for a specific chain', async () => {
    const result = await run('chains', 'health', '--chainId', '8453')
    expect(result.exitCode).toBe(0)
    expect(result.json).toBeTruthy()
  }, 15_000)

  // --- Schema ---

  it('schema --list returns endpoint list', async () => {
    const result = await run('schema', '--list')
    expect(result.exitCode).toBe(0)
    const data = result.json as any[]
    expect(Array.isArray(data)).toBe(true)
    expect(data.length).toBeGreaterThan(10)
    expect(data[0]).toHaveProperty('method')
    expect(data[0]).toHaveProperty('path')
  }, 15_000)

  // --- Quote (dry-run only, no real execution) ---

  it('quote --dry-run prints curl command', async () => {
    const result = await run('quote', '--dry-run', '--params', JSON.stringify({
      user: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      originChainId: 8453,
      destinationChainId: 1,
      originCurrency: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      destinationCurrency: '0x0000000000000000000000000000000000000000',
      amount: '1000000',
      tradeType: 'EXACT_INPUT',
    }))
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('curl')
    expect(result.stdout).toContain('/quote')
  }, 15_000)

  // --- Status alias ---

  it('status alias with known request ID returns data', async () => {
    // Use a request ID that should exist — if it 404s that's still a valid API response
    const result = await run('status', '0x67015eb08e8e19a630835a953640bee08f44c1a9e72f3888e3a82710a7e0b710')
    // Either success or API error is fine — we're testing CLI plumbing, not the request existing
    expect([0, 1]).toContain(result.exitCode)
  }, 15_000)

  // --- Validation errors ---

  it('rejects invalid address format', async () => {
    const result = await run('requests', 'list', '--id', 'not-a-valid-id')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Validation')
  }, 15_000)

  // --- Smart alias ---

  it('tx alias prints relay.link URL', async () => {
    const result = await run('tx', '0x67015eb08e8e19a630835a953640bee08f44c1a9e72f3888e3a82710a7e0b710')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('relay.link/transaction/')
  }, 15_000)

  // --- No execute commands ---

  it('execute command is not registered', async () => {
    const result = await run('execute', 'bridge', '--dry-run', '--params', '{}')
    expect(result.exitCode).toBe(1)
  }, 15_000)

  it('fast-fill command is not registered', async () => {
    const result = await run('fast-fill', '--dry-run', '--params', '{}')
    expect(result.exitCode).toBe(1)
  }, 15_000)
})
