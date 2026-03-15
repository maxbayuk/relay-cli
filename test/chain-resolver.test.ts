/**
 * Unit tests for token resolution.
 * Native token tests are pure (no network).
 * USDC/USDT tests hit the live Relay currencies API (marked with longer timeout).
 */

import { describe, it, expect } from 'vitest'
import { resolveTokenAddress } from '../src/core/chain-resolver.js'

describe('resolveTokenAddress', () => {
  // --- Pure tests (no network) ---

  it('resolves ETH to zero address on any chain', async () => {
    expect(await resolveTokenAddress('ETH', 1)).toBe('0x0000000000000000000000000000000000000000')
    expect(await resolveTokenAddress('ETH', 8453)).toBe('0x0000000000000000000000000000000000000000')
    expect(await resolveTokenAddress('eth', 42161)).toBe('0x0000000000000000000000000000000000000000')
  })

  it('resolves NATIVE and GAS to zero address', async () => {
    expect(await resolveTokenAddress('NATIVE', 1)).toBe('0x0000000000000000000000000000000000000000')
    expect(await resolveTokenAddress('GAS', 1)).toBe('0x0000000000000000000000000000000000000000')
  })

  it('is case-insensitive for native tokens', async () => {
    expect(await resolveTokenAddress('Eth', 1)).toBe(await resolveTokenAddress('ETH', 1))
    expect(await resolveTokenAddress('native', 1)).toBe(await resolveTokenAddress('NATIVE', 1))
  })

  // --- API-backed tests (require network) ---

  it('resolves USDC on Ethereum via API', async () => {
    const address = await resolveTokenAddress('USDC', 1)
    expect(address).toBeTruthy()
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/)
  }, 15_000)

  it('resolves USDC on Base via API', async () => {
    const address = await resolveTokenAddress('USDC', 8453)
    expect(address).toBeTruthy()
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/)
  }, 15_000)

  it('resolves USDT on Ethereum via API', async () => {
    const address = await resolveTokenAddress('USDT', 1)
    expect(address).toBeTruthy()
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/)
  }, 15_000)

  it('returns undefined for nonsense token', async () => {
    expect(await resolveTokenAddress('ZZZZNOTREAL', 1)).toBeUndefined()
  }, 15_000)
})
