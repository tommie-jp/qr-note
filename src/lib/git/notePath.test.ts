import { describe, expect, test } from 'vitest'
import { isValidCommitOid, noteFilePath } from './notePath'

describe('noteFilePath', () => {
  test('returns notes/<itemNo>.md for valid itemNos', () => {
    expect(noteFilePath('4518')).toBe('notes/4518.md')
    expect(noteFilePath('100x')).toBe('notes/100x.md')
    expect(noteFilePath('a_b-c')).toBe('notes/a_b-c.md')
  })

  test('throws for itemNos that could escape the notes/ directory', () => {
    expect(() => noteFilePath('../etc')).toThrow()
    expect(() => noteFilePath('a/b')).toThrow()
    expect(() => noteFilePath('a\\b')).toThrow()
    expect(() => noteFilePath('.')).toThrow()
    expect(() => noteFilePath('')).toThrow()
    expect(() => noteFilePath('a'.repeat(21))).toThrow()
  })
})

describe('isValidCommitOid', () => {
  test('accepts a full 40-hex oid', () => {
    expect(isValidCommitOid('deadbeef'.repeat(5))).toBe(true)
  })

  test('rejects short, uppercase, symbolic, and option-like values', () => {
    expect(isValidCommitOid('deadbeef')).toBe(false)
    expect(isValidCommitOid('DEADBEEF'.repeat(5))).toBe(false)
    expect(isValidCommitOid('HEAD')).toBe(false)
    expect(isValidCommitOid('main')).toBe(false)
    expect(isValidCommitOid('--all')).toBe(false)
    expect(isValidCommitOid('')).toBe(false)
  })
})
