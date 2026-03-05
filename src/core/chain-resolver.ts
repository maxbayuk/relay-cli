/**
 * Chain name → ID resolver with fuzzy matching.
 * Caches chain list from API (24h TTL) for fast lookups.
 */

import { readCache, writeCache } from './cache.js'
import { execute } from './executor.js'

const CHAINS_CACHE_KEY = 'chains'
const CHAINS_TTL_MS = 24 * 60 * 60 * 1000

interface ChainEntry {
  id: number
  name: string
  displayName: string
}

let chainsCache: ChainEntry[] | null = null

/**
 * Load the chains list, using cache when available.
 */
async function loadChains(): Promise<ChainEntry[]> {
  if (chainsCache) return chainsCache

  const cached = readCache<ChainEntry[]>(CHAINS_CACHE_KEY)
  if (cached) {
    chainsCache = cached
    return cached
  }

  const result = await execute({ method: 'GET', path: '/chains', queryParams: {} })
  const data = result.data as { chains: any[] }
  const chains: ChainEntry[] = data.chains.map(c => ({
    id: c.id,
    name: c.name,
    displayName: c.displayName,
  }))

  writeCache(CHAINS_CACHE_KEY, chains, CHAINS_TTL_MS)
  chainsCache = chains
  return chains
}

/**
 * Resolve a chain identifier to a chain ID.
 * Accepts: numeric ID, chain name, or display name (case-insensitive).
 *
 * Returns the chain ID or throws with suggestions.
 */
export async function resolveChainId(input: string): Promise<number> {
  // If it's already a number, return it
  const num = parseInt(input, 10)
  if (Number.isInteger(num) && num > 0 && String(num) === input) {
    return num
  }

  const chains = await loadChains()
  const lower = input.toLowerCase()

  // Exact match on name or displayName
  const exact = chains.find(c =>
    c.name.toLowerCase() === lower ||
    c.displayName.toLowerCase() === lower
  )
  if (exact) return exact.id

  // Common aliases
  const ALIASES: Record<string, string> = {
    eth: 'ethereum',
    op: 'optimism',
    arb: 'arbitrum',
    avax: 'avalanche',
    matic: 'polygon',
    poly: 'polygon',
    bnb: 'bsc',
    zk: 'zksync',
    zksync: 'zksync-era',
    sol: 'solana',
    btc: 'bitcoin',
  }

  const aliased = ALIASES[lower]
  if (aliased) {
    const match = chains.find(c => c.name.toLowerCase() === aliased)
    if (match) return match.id
  }

  // Fuzzy match: contains
  const fuzzy = chains.filter(c =>
    c.name.toLowerCase().includes(lower) ||
    c.displayName.toLowerCase().includes(lower)
  )

  if (fuzzy.length === 1) return fuzzy[0].id

  if (fuzzy.length > 1) {
    const suggestions = fuzzy.slice(0, 5).map(c => `  ${c.id} (${c.displayName})`).join('\n')
    throw new Error(`Ambiguous chain "${input}". Did you mean:\n${suggestions}`)
  }

  // No match — suggest closest
  const suggestions = chains
    .map(c => ({ chain: c, score: similarity(lower, c.name.toLowerCase()) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(s => `  ${s.chain.id} (${s.chain.displayName})`)
    .join('\n')

  throw new Error(`Unknown chain "${input}". Did you mean:\n${suggestions}`)
}

/**
 * Resolve a common token symbol to its address on a given chain.
 * Only handles well-known tokens — returns undefined for unknown symbols.
 */
export function resolveTokenAddress(symbol: string, chainId: number): string | undefined {
  const upper = symbol.toUpperCase()

  // Native gas token (ETH on EVM chains, etc.)
  if (['ETH', 'NATIVE', 'GAS'].includes(upper)) {
    return '0x0000000000000000000000000000000000000000'
  }

  // USDC addresses per chain
  const USDC: Record<number, string> = {
    1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',      // Ethereum
    10: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',     // Optimism
    137: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',    // Polygon
    8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',   // Base
    42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',  // Arbitrum
    43114: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',  // Avalanche
  }

  // USDT addresses per chain
  const USDT: Record<number, string> = {
    1: '0xdAC17F958D2ee523a2206206994597C13D831ec7',      // Ethereum
    10: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',     // Optimism
    137: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',    // Polygon
    8453: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',   // Base
    42161: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',  // Arbitrum
  }

  if (upper === 'USDC') return USDC[chainId]
  if (upper === 'USDT') return USDT[chainId]

  return undefined
}

/**
 * Simple string similarity score (Dice coefficient).
 */
function similarity(a: string, b: string): number {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0

  const bigrams = new Map<string, number>()
  for (let i = 0; i < a.length - 1; i++) {
    const bigram = a.substring(i, i + 2)
    bigrams.set(bigram, (bigrams.get(bigram) || 0) + 1)
  }

  let intersectionSize = 0
  for (let i = 0; i < b.length - 1; i++) {
    const bigram = b.substring(i, i + 2)
    const count = bigrams.get(bigram) || 0
    if (count > 0) {
      bigrams.set(bigram, count - 1)
      intersectionSize++
    }
  }

  return (2.0 * intersectionSize) / (a.length + b.length - 2)
}
