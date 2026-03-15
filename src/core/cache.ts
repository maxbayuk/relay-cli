import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const CACHE_DIR = path.join(os.homedir(), '.relay-cli', 'cache')

interface CacheEntry<T> {
  data: T
  timestamp: number
  ttlMs: number
}

function ensureCacheDir(): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
}

export function getCachePath(key: string): string {
  return path.join(CACHE_DIR, `${key}.json`)
}

export function readCache<T>(key: string): T | null {
  const filePath = getCachePath(key)
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const entry: CacheEntry<T> = JSON.parse(raw)
    const age = Date.now() - entry.timestamp
    if (age > entry.ttlMs) {
      return null // expired
    }
    return entry.data
  } catch (err: unknown) {
    // File doesn't exist = normal cache miss, no warning needed
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    // Permission errors, corrupt JSON, etc. — warn so users know cache is broken
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Warning: cache read failed for "${key}": ${msg}`)
    console.error('  Run "relay cache --clear" to reset.\n')
    return null
  }
}

export function writeCache<T>(key: string, data: T, ttlMs: number): void {
  ensureCacheDir()
  const entry: CacheEntry<T> = { data, timestamp: Date.now(), ttlMs }
  fs.writeFileSync(getCachePath(key), JSON.stringify(entry))
}

export function clearCache(key?: string): void {
  if (key) {
    const filePath = getCachePath(key)
    try { fs.unlinkSync(filePath) } catch { /* ignore */ }
  } else {
    try {
      const files = fs.readdirSync(CACHE_DIR)
      for (const file of files) {
        fs.unlinkSync(path.join(CACHE_DIR, file))
      }
    } catch { /* ignore */ }
  }
}

export function getCacheAge(key: string): number | null {
  const filePath = getCachePath(key)
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const entry = JSON.parse(raw)
    return Date.now() - entry.timestamp
  } catch {
    return null
  }
}
