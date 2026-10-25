import { describe, expect, test } from 'vitest'
import {
  agoLabel,
  CLIPBOARD_TTL_MS,
  isSlotExpired,
  MAX_CLIPBOARD_TEXT_BYTES,
  parseSlotMeta,
  slotLabel,
  textByteLength,
} from './slot'

const NOW = new Date('2026-10-25T12:00:00.000Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms)

describe('isSlotExpired', () => {
  test('10 分に 1 ミリ秒足りなければ生きている', () => {
    expect(isSlotExpired(ago(CLIPBOARD_TTL_MS - 1), NOW)).toBe(false)
  })

  test('10 分ちょうどで切れる', () => {
    expect(isSlotExpired(ago(CLIPBOARD_TTL_MS), NOW)).toBe(true)
  })

  test('ISO 文字列も受ける', () => {
    expect(isSlotExpired(ago(1000).toISOString(), NOW)).toBe(false)
  })

  // 読めない日時を「生きている」にすると、消えるはずの中身が残り続ける
  test('読めない日時は切れた扱い', () => {
    expect(isSlotExpired('not-a-date', NOW)).toBe(true)
  })
})

describe('textByteLength', () => {
  test('UTF-8 のバイト数で数える', () => {
    expect(textByteLength('abc')).toBe(3)
    expect(textByteLength('あ')).toBe(3)
  })

  test('上限の定数は 64KB', () => {
    expect(MAX_CLIPBOARD_TEXT_BYTES).toBe(64 * 1024)
  })
})

describe('slotLabel', () => {
  test('文字は code point で数える (絵文字は 1 字)', () => {
    expect(slotLabel({ kind: 'text', bytes: 8, updatedAt: '', text: 'a😀b' })).toBe('文字 3 字')
  })

  test('画像は MB (小数 1 桁)', () => {
    expect(slotLabel({ kind: 'image', bytes: 1.2 * 1024 * 1024, updatedAt: '' })).toBe(
      '画像 1.2MB',
    )
  })

  test('小さい画像は KB', () => {
    expect(slotLabel({ kind: 'image', bytes: 512 * 1024, updatedAt: '' })).toBe('画像 512KB')
  })
})

describe('agoLabel', () => {
  test('1 分未満は「いま」', () => {
    expect(agoLabel(ago(59_000), NOW)).toBe('いま')
  })

  test('分単位で切り捨てる', () => {
    expect(agoLabel(ago(3 * 60_000 + 30_000), NOW)).toBe('3 分前')
    expect(agoLabel(ago(9 * 60_000), NOW)).toBe('9 分前')
  })

  // 時計のずれで未来になっても負の分を出さない
  test('未来の日時は「いま」', () => {
    expect(agoLabel(new Date(NOW.getTime() + 5000), NOW)).toBe('いま')
  })
})

describe('parseSlotMeta', () => {
  test('文字のメタを読む', () => {
    expect(
      parseSlotMeta({ kind: 'text', bytes: 3, updatedAt: '2026-10-25T12:00:00.000Z', text: 'abc' }),
    ).toEqual({ kind: 'text', bytes: 3, updatedAt: '2026-10-25T12:00:00.000Z', text: 'abc' })
  })

  test('画像のメタを読む (text は付かない)', () => {
    expect(
      parseSlotMeta({ kind: 'image', bytes: 10, updatedAt: '2026-10-25T12:00:00.000Z' }),
    ).toEqual({ kind: 'image', bytes: 10, updatedAt: '2026-10-25T12:00:00.000Z' })
  })

  test.each([
    null,
    undefined,
    'x',
    42,
    {},
    { kind: 'video', bytes: 1, updatedAt: 'x' },
    { kind: 'image', bytes: -1, updatedAt: 'x' },
    { kind: 'image', bytes: 1 },
    { kind: 'text', bytes: 1, updatedAt: 'x' },
  ])('知らない形は null に畳む: %j', (value) => {
    expect(parseSlotMeta(value)).toBeNull()
  })
})
