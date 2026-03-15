import jmespath from 'jmespath'

export type OutputFormat = 'json' | 'table' | 'minimal'

export interface FormatOptions {
  format: OutputFormat
  fields?: string
  preset?: string
  pretty?: boolean
}

/** Built-in field presets for common use cases */
const PRESETS: Record<string, string> = {
  // Chains presets
  'chains-slim': 'chains[].{id: id, name: name, displayName: displayName, vmType: vmType, depositEnabled: depositEnabled}',
  'chains-health': 'chains[].{id: id, name: name, displayName: displayName, disabled: disabled, blockProductionLagging: blockProductionLagging}',
  'chains-ids': 'chains[].{id: id, name: name}',

  // Request presets
  'request-status': 'requests[0].{id: id, status: status, createdAt: createdAt, updatedAt: updatedAt}',
  'request-slim': 'requests[0].{id: id, status: status, user: user, recipient: recipient, metadata: metadata}',
  'request-summary': 'requests[0].{status: status, user: user, recipient: data.metadata.recipient, from: data.metadata.currencyIn.currency.symbol, fromChain: data.metadata.currencyIn.currency.chainId, fromAmount: data.metadata.currencyIn.amountFormatted, fromUsd: data.metadata.currencyIn.amountUsd, to: data.metadata.currencyOut.currency.symbol, toChain: data.metadata.currencyOut.currency.chainId, toAmount: data.metadata.currencyOut.amountFormatted, toUsd: data.metadata.currencyOut.amountUsd, feesUsd: data.feesUsd, referrer: referrer, createdAt: createdAt}',

  // Quote presets
  'quote-summary': 'details.{operation: operation, from: currencyIn.currency.symbol, fromChain: currencyIn.currency.chainId, fromAmount: currencyIn.amountFormatted, fromUsd: currencyIn.amountUsd, to: currencyOut.currency.symbol, toChain: currencyOut.currency.chainId, toAmount: currencyOut.amountFormatted, toUsd: currencyOut.amountUsd, rate: rate, totalImpact: totalImpact, slippage: slippageTolerance.destination.percent, timeEstimate: timeEstimate}',
  'quote-fees': 'fees.{relayerGas: relayerGas.amountUsd, relayerService: relayerService.amountUsd, app: app.amountUsd, subsidized: subsidized.amountUsd}',
  'quote-impact': 'details.{slippageTolerance: slippageTolerance.destination.percent, totalImpact: totalImpact, swapImpact: swapImpact, expandedPriceImpact: expandedPriceImpact, rate: rate, expectedOutput: currencyOut.amountFormatted, expectedOutputUsd: currencyOut.amountUsd, minimumOutput: currencyOut.minimumAmount}',

  // Request outcome presets
  'request-slippage-outcome': 'requests[0].{status: status, slippageTolerance: data.slippageTolerance, from: data.metadata.currencyIn.currency.symbol, fromChain: data.metadata.currencyIn.currency.chainId, fromAmount: data.metadata.currencyIn.amountFormatted, fromUsd: data.metadata.currencyIn.amountUsd, to: data.metadata.currencyOut.currency.symbol, toChain: data.metadata.currencyOut.currency.chainId, expectedOutput: data.metadata.currencyOut.amountFormatted, expectedOutputUsd: data.metadata.currencyOut.amountUsd, minimumOutput: data.metadata.currencyOut.minimumAmount, currentValueUsd: data.metadata.currencyOut.amountUsdCurrent}',
}

/**
 * Apply field filtering to response data using JMESPath.
 * When a preset returns null/empty, warns and falls back to raw data.
 */
export function applyFieldFilter(data: unknown, fields?: string, preset?: string): unknown {
  const expression = preset ? PRESETS[preset] : fields
  if (!expression) return data
  try {
    const result = jmespath.search(data, expression)

    // If a preset returned nothing useful, the API schema may have changed
    if (preset && isEmpty(result)) {
      console.error(`Warning: preset "${preset}" returned no data — the API response shape may have changed.`)
      console.error(`  Try without --preset to see the full response, or use --fields with a custom JMESPath expression.\n`)
      return data
    }

    return result
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`Invalid JMESPath expression: ${msg}`)
  }
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (Array.isArray(value) && value.length === 0) return true
  return false
}

/**
 * Format data for output.
 */
export function formatOutput(data: unknown, options: FormatOptions): string {
  // Apply field filtering first
  const filtered = applyFieldFilter(data, options.fields, options.preset)

  switch (options.format) {
    case 'json':
      return JSON.stringify(filtered, null, options.pretty !== false ? 2 : 0)

    case 'minimal':
      return formatMinimal(filtered)

    case 'table':
      return formatTable(filtered)

    default:
      return JSON.stringify(filtered, null, 2)
  }
}

/**
 * Minimal output: one value per line, no decoration.
 */
function formatMinimal(data: unknown): string {
  if (Array.isArray(data)) {
    return data.map(item => {
      if (typeof item === 'object' && item !== null) {
        return Object.values(item).join('\t')
      }
      return String(item)
    }).join('\n')
  }
  if (typeof data === 'object' && data !== null) {
    return Object.entries(data)
      .map(([k, v]) => `${k}\t${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join('\n')
  }
  return String(data)
}

/**
 * Simple table output for arrays of objects.
 */
function formatTable(data: unknown): string {
  if (!Array.isArray(data) || data.length === 0) {
    return formatMinimal(data)
  }

  const first = data[0]
  if (typeof first !== 'object' || first === null) {
    return formatMinimal(data)
  }

  const keys = Object.keys(first)

  // Calculate column widths
  const widths = keys.map(k => {
    const values = data.map(row => {
      const val = (row as Record<string, unknown>)[k]
      return typeof val === 'object' ? JSON.stringify(val) : String(val ?? '')
    })
    return Math.max(k.length, ...values.map(v => v.length))
  })

  // Cap column widths at 40 chars
  const cappedWidths = widths.map(w => Math.min(w, 40))

  // Header
  const header = keys.map((k, i) => k.padEnd(cappedWidths[i])).join('  ')
  const separator = cappedWidths.map(w => '─'.repeat(w)).join('──')

  // Rows
  const rows = data.map(row => {
    return keys.map((k, i) => {
      const val = (row as Record<string, unknown>)[k]
      const str = typeof val === 'object' ? JSON.stringify(val) : String(val ?? '')
      return str.substring(0, cappedWidths[i]).padEnd(cappedWidths[i])
    }).join('  ')
  })

  return [header, separator, ...rows].join('\n')
}

/**
 * Detect the best output format based on environment.
 */
export function detectFormat(explicit?: OutputFormat): OutputFormat {
  if (explicit) return explicit
  // TTY → table (human), pipe → json (agent/script)
  return process.stdout.isTTY ? 'table' : 'json'
}
