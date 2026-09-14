import { describe, expect, test } from 'vitest'
import { normalizePasskeyLabel, PASSKEY_LABEL_FALLBACK, PASSKEY_LABEL_MAX } from './passkeyLabel'

describe('normalizePasskeyLabel', () => {
  test('keeps a name the user typed', () => {
    expect(normalizePasskeyLabel('iPhone')).toBe('iPhone')
  })

  test('keeps a non-ASCII name', () => {
    expect(normalizePasskeyLabel('とみーの iPhone')).toBe('とみーの iPhone')
  })

  test('trims surrounding whitespace', () => {
    expect(normalizePasskeyLabel('  iPhone  ')).toBe('iPhone')
  })

  test('falls back when the name is empty', () => {
    expect(normalizePasskeyLabel('')).toBe(PASSKEY_LABEL_FALLBACK)
  })

  test('falls back when the name is only whitespace', () => {
    expect(normalizePasskeyLabel('   ')).toBe(PASSKEY_LABEL_FALLBACK)
  })

  test('falls back when the value is not a string', () => {
    // JSON ボディは外から来る。型は信用しない
    expect(normalizePasskeyLabel(undefined)).toBe(PASSKEY_LABEL_FALLBACK)
    expect(normalizePasskeyLabel(null)).toBe(PASSKEY_LABEL_FALLBACK)
    expect(normalizePasskeyLabel(42)).toBe(PASSKEY_LABEL_FALLBACK)
    expect(normalizePasskeyLabel({ label: 'x' })).toBe(PASSKEY_LABEL_FALLBACK)
  })

  test('strips control characters that would break the list display', () => {
    expect(normalizePasskeyLabel('iPhone\n\t15')).toBe('iPhone 15')
  })

  test('caps an over-long name instead of rejecting it', () => {
    const long = 'あ'.repeat(PASSKEY_LABEL_MAX + 50)

    expect(normalizePasskeyLabel(long)).toHaveLength(PASSKEY_LABEL_MAX)
  })

  test('falls back when the name is only control characters', () => {
    expect(normalizePasskeyLabel('\u0001\u0002')).toBe(PASSKEY_LABEL_FALLBACK)
  })
})
