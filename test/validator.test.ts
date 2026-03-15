/**
 * Unit tests for input validation.
 */

import { describe, it, expect } from 'vitest'
import {
  validateAddress,
  validateRequestId,
  validateChainId,
  validateAmount,
  validateTxHash,
  validateParams,
} from '../src/core/validator.js'

describe('validateAddress', () => {
  it('accepts valid checksummed address', () => {
    expect(validateAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBeNull()
  })

  it('accepts valid lowercase address', () => {
    expect(validateAddress('0xd8da6bf26964af9d7eed9e03e53415d37aa96045')).toBeNull()
  })

  it('accepts zero address (native token)', () => {
    expect(validateAddress('0x0000000000000000000000000000000000000000')).toBeNull()
  })

  it('rejects address without 0x prefix', () => {
    const err = validateAddress('d8dA6BF26964aF9D7eEd9e03E53415D37aA96045')
    expect(err).not.toBeNull()
    expect(err!.message).toContain('start with 0x')
    expect(err!.suggestion).toContain('0x')
  })

  it('rejects address with wrong length', () => {
    const err = validateAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA9604') // 41 chars
    expect(err).not.toBeNull()
    expect(err!.message).toContain('42 characters')
  })

  it('rejects address with invalid hex', () => {
    const err = validateAddress('0xZZZZ6BF26964aF9D7eEd9e03E53415D37aA96045')
    expect(err).not.toBeNull()
  })
})

describe('validateRequestId', () => {
  it('accepts valid 66-char request ID', () => {
    const id = '0x' + 'a'.repeat(64)
    expect(validateRequestId(id)).toBeNull()
  })

  it('rejects without 0x prefix', () => {
    const err = validateRequestId('a'.repeat(64))
    expect(err).not.toBeNull()
    expect(err!.message).toContain('start with 0x')
  })

  it('rejects wrong length', () => {
    const err = validateRequestId('0x' + 'a'.repeat(63))
    expect(err).not.toBeNull()
    expect(err!.message).toContain('66 characters')
  })
})

describe('validateChainId', () => {
  it('accepts positive integers', () => {
    expect(validateChainId('1')).toBeNull()
    expect(validateChainId('8453')).toBeNull()
    expect(validateChainId('42161')).toBeNull()
  })

  it('rejects zero', () => {
    expect(validateChainId('0')).not.toBeNull()
  })

  it('rejects negative numbers', () => {
    expect(validateChainId('-1')).not.toBeNull()
  })

  it('rejects non-numeric strings', () => {
    expect(validateChainId('base')).not.toBeNull()
    expect(validateChainId('8453.5')).not.toBeNull()
  })
})

describe('validateAmount', () => {
  it('accepts numeric strings', () => {
    expect(validateAmount('0')).toBeNull()
    expect(validateAmount('1000000')).toBeNull()
    expect(validateAmount('99999999999999999999')).toBeNull()
  })

  it('rejects decimals', () => {
    expect(validateAmount('1.5')).not.toBeNull()
  })

  it('rejects negative', () => {
    expect(validateAmount('-100')).not.toBeNull()
  })

  it('rejects non-numeric', () => {
    expect(validateAmount('abc')).not.toBeNull()
    expect(validateAmount('')).not.toBeNull()
  })
})

describe('validateTxHash', () => {
  it('accepts valid 66-char tx hash', () => {
    const hash = '0x' + 'f'.repeat(64)
    expect(validateTxHash(hash)).toBeNull()
  })

  it('rejects without 0x prefix', () => {
    const err = validateTxHash('f'.repeat(64))
    expect(err).not.toBeNull()
    expect(err!.message).toContain('start with 0x')
  })
})

describe('validateParams', () => {
  it('validates multiple params at once', () => {
    const errors = validateParams({
      user: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      originChainId: '8453',
      amount: '1000000',
    })
    expect(errors).toHaveLength(0)
  })

  it('returns errors for invalid params', () => {
    const errors = validateParams({
      user: 'not-an-address',
      originChainId: 'base',
      amount: '1.5',
    })
    expect(errors).toHaveLength(3)
  })

  it('skips unknown param names', () => {
    const errors = validateParams({
      unknownParam: 'whatever',
    })
    expect(errors).toHaveLength(0)
  })

  it('skips empty values', () => {
    const errors = validateParams({
      user: '',
    })
    expect(errors).toHaveLength(0)
  })
})
