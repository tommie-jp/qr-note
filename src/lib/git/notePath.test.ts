import { describe, expect, test } from 'vitest'
import { isValidCommitOid, legacyNoteFilePath, noteFilePath } from './notePath'

const ID = '00000000-0000-7000-8000-000000004518'

describe('noteFilePath', () => {
  test('returns notes/<itemId>.md for UUID itemIds', () => {
    expect(noteFilePath(ID)).toBe(`notes/${ID}.md`)
  })

  // 旧番号の履歴は legacyNoteFilePath が引く (docs/107)
  test('throws for legacy numbers', () => {
    expect(() => noteFilePath('4518')).toThrow()
    expect(() => noteFilePath('100x')).toThrow()
    expect(() => noteFilePath('a_b-c')).toThrow()
  })

  test('throws for itemIds that could escape the notes/ directory', () => {
    expect(() => noteFilePath('../etc')).toThrow()
    expect(() => noteFilePath('a/b')).toThrow()
    expect(() => noteFilePath('a\\b')).toThrow()
    expect(() => noteFilePath('.')).toThrow()
    expect(() => noteFilePath('')).toThrow()
    expect(() => noteFilePath(`../${ID}`)).toThrow()
  })
})

describe('legacyNoteFilePath', () => {
  test('returns notes/<itemNo>.md for legacy numbers', () => {
    expect(legacyNoteFilePath('4518')).toBe('notes/4518.md')
    expect(legacyNoteFilePath('100x')).toBe('notes/100x.md')
    expect(legacyNoteFilePath('a_b-c')).toBe('notes/a_b-c.md')
  })

  test('throws for UUIDs (新しいノートは noteFilePath で引く)', () => {
    expect(() => legacyNoteFilePath(ID)).toThrow()
  })

  test('throws for itemNos that could escape the notes/ directory', () => {
    expect(() => legacyNoteFilePath('../etc')).toThrow()
    expect(() => legacyNoteFilePath('a/b')).toThrow()
    expect(() => legacyNoteFilePath('a\\b')).toThrow()
    expect(() => legacyNoteFilePath('.')).toThrow()
    expect(() => legacyNoteFilePath('')).toThrow()
    expect(() => legacyNoteFilePath('a'.repeat(21))).toThrow()
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
