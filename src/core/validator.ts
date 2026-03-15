/**
 * Input validation for Relay API parameters.
 * Validates before HTTP requests to give fast, clear error messages.
 */

export interface ValidationError {
  param: string
  value: string
  message: string
  suggestion?: string
}

/**
 * Validate an EVM address (0x-prefixed, 40 hex chars).
 */
export function validateAddress(value: string, paramName = 'address'): ValidationError | null {
  if (/^0x[0-9a-fA-F]{40}$/.test(value)) return null

  if (!value.startsWith('0x')) {
    return { param: paramName, value, message: 'Address must start with 0x', suggestion: `0x${value}` }
  }
  if (value.length !== 42) {
    return { param: paramName, value, message: `Address must be 42 characters (got ${value.length})` }
  }
  return { param: paramName, value, message: 'Address contains invalid hex characters' }
}

/**
 * Validate a request ID (0x-prefixed, 64 hex chars = 66 total).
 */
export function validateRequestId(value: string, paramName = 'requestId'): ValidationError | null {
  if (/^0x[0-9a-fA-F]{64}$/.test(value)) return null

  if (!value.startsWith('0x')) {
    return { param: paramName, value, message: 'Request ID must start with 0x' }
  }
  if (value.length !== 66) {
    return { param: paramName, value, message: `Request ID must be 66 characters (got ${value.length})` }
  }
  return { param: paramName, value, message: 'Request ID contains invalid hex characters' }
}

/**
 * Validate a chain ID is a positive integer.
 */
export function validateChainId(value: string, paramName = 'chainId'): ValidationError | null {
  const num = parseInt(value, 10)
  if (Number.isInteger(num) && num > 0 && String(num) === value) return null
  return { param: paramName, value, message: 'Chain ID must be a positive integer' }
}

/**
 * Validate a wei amount is a numeric string.
 */
export function validateAmount(value: string, paramName = 'amount'): ValidationError | null {
  if (/^\d+$/.test(value)) return null
  return { param: paramName, value, message: 'Amount must be a numeric string (wei, no decimals)' }
}

/**
 * Validate a transaction hash (0x-prefixed, 64 hex chars).
 */
export function validateTxHash(value: string, paramName = 'hash'): ValidationError | null {
  if (/^0x[0-9a-fA-F]{64}$/.test(value)) return null
  if (!value.startsWith('0x')) {
    return { param: paramName, value, message: 'Transaction hash must start with 0x' }
  }
  return { param: paramName, value, message: 'Transaction hash must be 66 characters of hex' }
}

/** Map param names to their validators */
const PARAM_VALIDATORS: Record<string, (value: string, name: string) => ValidationError | null> = {
  // Address fields
  user: validateAddress,
  wallet: validateAddress,
  address: validateAddress,
  recipient: validateAddress,
  originCurrency: validateAddress,
  destinationCurrency: validateAddress,
  currency: validateAddress,

  // Chain IDs
  chainId: validateChainId,
  originChainId: validateChainId,
  destinationChainId: validateChainId,

  // Request/tx identifiers
  requestId: validateRequestId,
  id: validateRequestId,
  hash: validateTxHash,
  orderId: validateRequestId,

  // Amounts
  amount: validateAmount,
}

/**
 * Validate a set of parameters, returning all errors found.
 */
export function validateParams(params: Record<string, string>): ValidationError[] {
  const errors: ValidationError[] = []
  for (const [name, value] of Object.entries(params)) {
    if (!value) continue
    const validator = PARAM_VALIDATORS[name]
    if (validator) {
      const error = validator(value, name)
      if (error) errors.push(error)
    }
  }
  return errors
}

/**
 * Format validation errors for display.
 */
export function formatValidationErrors(errors: ValidationError[]): string {
  return errors.map(e => {
    let msg = `  ${e.param}: ${e.message} (got "${e.value}")`
    if (e.suggestion) msg += `\n    Did you mean: ${e.suggestion}?`
    return msg
  }).join('\n')
}
