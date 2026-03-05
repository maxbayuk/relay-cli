import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const CONFIG_PATH = path.join(os.homedir(), '.relay-cli', 'config.json')

interface Config {
  apiKey?: string
}

function readConfig(): Config {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

export function writeConfig(config: Partial<Config>): void {
  const existing = readConfig()
  const merged = { ...existing, ...config }
  const dir = path.dirname(CONFIG_PATH)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), { mode: 0o600 })
}

/**
 * Resolve API key with priority: flag > env > config file
 */
export function resolveApiKey(flagValue?: string): string | undefined {
  if (flagValue) return flagValue
  if (process.env.RELAY_API_KEY) return process.env.RELAY_API_KEY
  const config = readConfig()
  return config.apiKey
}

export function getBaseUrl(testnet = false): string {
  if (process.env.RELAY_API_URL) return process.env.RELAY_API_URL
  return testnet
    ? 'https://api.testnets.relay.link'
    : 'https://api.relay.link'
}
