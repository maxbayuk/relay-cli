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

const TOKEN_CACHE_KEY_PREFIX = 'token'
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Resolve a token symbol to its contract address on a given chain.
 * Uses the Relay currencies API to look up tokens on any supported chain.
 * Results are cached for 24h per chain+symbol pair.
 */
export async function resolveTokenAddress(symbol: string, chainId: number): Promise<string | undefined> {
  const upper = symbol.toUpperCase()

  // Native gas token — zero address on all chains
  if (['ETH', 'NATIVE', 'GAS'].includes(upper)) {
    return '0x0000000000000000000000000000000000000000'
  }

  // Check cache first
  const cacheKey = `${TOKEN_CACHE_KEY_PREFIX}-${chainId}-${upper}`
  const cached = readCache<string>(cacheKey)
  if (cached) return cached

  // Query the currencies v2 API (returns flat array of matches across chains)
  try {
    const result = await execute({
      method: 'POST',
      path: '/currencies/v2',
      queryParams: {},
      body: { chainId, term: upper, limit: 20 },
    })

    const rawData = result.data
    if (!Array.isArray(rawData)) return undefined

    // Filter to matching chainId
    const currencies = rawData.filter(
      (item: any) => item && typeof item === 'object' && item.chainId === chainId
    )

    if (currencies.length === 0) return undefined

    // Find exact symbol match (case-insensitive)
    const match = currencies.find(c => c.symbol.toUpperCase() === upper)
    if (match) {
      writeCache(cacheKey, match.address, TOKEN_TTL_MS)
      return match.address
    }

    return undefined
  } catch {
    // API failure — don't block the user, just return undefined
    return undefined
  }
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
