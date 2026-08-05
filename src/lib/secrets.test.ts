import { describe, expect, test } from 'vitest'
import {
  allSecretNames,
  findSecretNotation,
  isValidSecretName,
  secretAtCursor,
  secretLabel,
  secretNameFromUrl,
  secretNotation,
  secretToolbarLabel,
  secretUrl,
} from './secrets'

const NAME = '0123abcd-4567-89ab-cdef-0123456789ab'
const OTHER = 'fedcba98-7654-3210-fedc-ba9876543210'

describe('isValidSecretName', () => {
  test('accepts a bare lowercase UUID', () => {
    expect(isValidSecretName(NAME)).toBe(true)
  })

  test('rejects a name with an extension (画像名と取り違えない)', () => {
    expect(isValidSecretName(`${NAME}.png`)).toBe(false)
  })

  test('rejects traversal and uppercase', () => {
    expect(isValidSecretName('../../etc/passwd')).toBe(false)
    expect(isValidSecretName(NAME.toUpperCase())).toBe(false)
  })
})

describe('secretNotation', () => {
  test('builds the image-style notation used in memo', () => {
    expect(secretNotation('銀行パスワード', NAME)).toBe(
      `![銀行パスワード](${secretUrl(NAME)})`,
    )
  })

  test('strips brackets and newlines that would break the notation', () => {
    expect(secretLabel('a[b]c\nd')).toBe('abcd')
  })

  test('falls back to a default label when empty', () => {
    expect(secretLabel('   ')).toBe('シークレット')
  })
})

describe('secretNameFromUrl', () => {
  test('reads the name from a secret url', () => {
    expect(secretNameFromUrl(secretUrl(NAME))).toBe(NAME)
  })

  test('ignores image urls', () => {
    expect(secretNameFromUrl(`/api/images/${NAME}.png`)).toBe(null)
  })

  test('ignores a malformed name (本文から拾った文字列を信じない)', () => {
    expect(secretNameFromUrl('/api/secrets/not-a-uuid')).toBe(null)
  })
})

describe('allSecretNames', () => {
  test('collects names in first-seen order without duplicates', () => {
    const memo = [
      `住所は ![住所](${secretUrl(NAME)}) です`,
      `![鍵](${secretUrl(OTHER)})`,
      `再掲 ![住所](${secretUrl(NAME)})`,
    ].join('\n')
    expect(allSecretNames(memo)).toEqual([NAME, OTHER])
  })

  test('ignores references inside code fences (tags.ts と同じ流儀)', () => {
    const memo = ['```', `![x](${secretUrl(NAME)})`, '```'].join('\n')
    expect(allSecretNames(memo)).toEqual([])
  })

  test('returns empty for a memo with no secrets', () => {
    expect(allSecretNames('ただの本文 ![写真](/api/images/x.png)')).toEqual([])
  })
})

describe('secretAtCursor', () => {
  const notation = secretNotation('住所', NAME)
  const doc = `前 ${notation} 後`
  const start = doc.indexOf(notation)

  test('finds the secret the cursor sits in', () => {
    const hit = secretAtCursor(doc, start + 3)
    expect(hit).toEqual({
      name: NAME,
      label: '住所',
      from: start,
      to: start + notation.length,
    })
  })

  test('includes both edges (記法の直後でも掴める)', () => {
    expect(secretAtCursor(doc, start)?.name).toBe(NAME)
    expect(secretAtCursor(doc, start + notation.length)?.name).toBe(NAME)
  })

  test('returns null outside the notation', () => {
    expect(secretAtCursor(doc, 0)).toBe(null)
    expect(secretAtCursor(doc, doc.length)).toBe(null)
  })

  test('ignores plain images', () => {
    expect(secretAtCursor('![写真](/api/images/a.png)', 3)).toBe(null)
  })
})

describe('secretToolbarLabel', () => {
  const notation = secretNotation('住所', NAME)
  const doc = `前 ${notation} 後`
  const start = doc.indexOf(notation)

  test('says 編集 while the cursor sits on a secret', () => {
    expect(secretToolbarLabel(doc, start + 3)).toBe('秘密を編集')
  })

  test('says 秘密 elsewhere (新規挿入になる)', () => {
    expect(secretToolbarLabel(doc, 0)).toBe('秘密')
    expect(secretToolbarLabel('ただの本文', 2)).toBe('秘密')
  })
})

describe('findSecretNotation', () => {
  test('locates the notation by name (保存後の置換用)', () => {
    const doc = `a\n![旧ラベル](${secretUrl(NAME)})\nb`
    const range = findSecretNotation(doc, NAME)
    expect(range && doc.slice(range.from, range.to)).toBe(
      `![旧ラベル](${secretUrl(NAME)})`,
    )
  })

  test('returns null when the reference is gone (利用者が消した)', () => {
    expect(findSecretNotation('本文だけ', NAME)).toBe(null)
  })
})
