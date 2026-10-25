import { describe, expect, test } from 'vitest'
import {
  agoLabel,
  CLIPBOARD_TTL_MS,
  isSlotExpired,
  isPasteable,
  kindOfMime,
  slotFileName,
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
    expect(slotLabel({ kind: 'image', bytes: 1.2 * 1024 * 1024, updatedAt: '', mime: 'image/png' })).toBe(
      '画像 1.2MB',
    )
  })

  test('小さい画像は KB', () => {
    expect(slotLabel({ kind: 'image', bytes: 512 * 1024, updatedAt: '', mime: 'image/png' })).toBe('画像 512KB')
  })
})

describe('slotLabel (画像以外のファイル)', () => {
  test.each([
    ['video', 'video/mp4', '動画 12.3MB'],
    ['audio', 'audio/mpeg', '音声 12.3MB'],
    ['pdf', 'application/pdf', 'PDF 12.3MB'],
    ['textfile', 'text/csv; charset=utf-8', 'テキストファイル 12.3MB'],
  ] as const)('%s は種類と大きさ', (kind, mime, label) => {
    expect(slotLabel({ kind, bytes: 12.3 * 1024 * 1024, updatedAt: '', mime })).toBe(label)
  })
})

describe('kindOfMime', () => {
  test.each([
    ['image/png', 'image'],
    ['image/heic', 'image'],
    ['video/quicktime', 'video'],
    ['audio/webm', 'audio'],
    ['application/pdf', 'pdf'],
    ['text/markdown; charset=utf-8', 'textfile'],
  ])('%s は %s', (mime, kind) => {
    expect(kindOfMime(mime)).toBe(kind)
  })

  // HTML や任意のバイナリは種類として認めない (サーバは受けない)
  test.each(['application/octet-stream', 'application/zip', '', 'x'])('%s は null', (mime) => {
    expect(kindOfMime(mime)).toBeNull()
  })
})

describe('isPasteable', () => {
  test('クリップボードに載せられるのは文字と画像だけ', () => {
    expect(isPasteable('text')).toBe(true)
    expect(isPasteable('image')).toBe(true)
    for (const kind of ['video', 'audio', 'pdf', 'textfile'] as const) {
      expect(isPasteable(kind)).toBe(false)
    }
  })
})

describe('slotFileName (保存するときの名前)', () => {
  const AT = new Date('2026-10-25T12:03:04')

  test.each([
    ['image/png', 'png'],
    ['image/jpeg', 'jpg'],
    ['video/mp4', 'mp4'],
    ['video/quicktime', 'mov'],
    ['audio/mpeg', 'mp3'],
    ['application/pdf', 'pdf'],
    ['text/csv; charset=utf-8', 'csv'],
    ['text/markdown; charset=utf-8', 'md'],
  ])('%s は .%s', (mime, ext) => {
    expect(
      slotFileName({ kind: kindOfMime(mime) ?? 'image', bytes: 1, updatedAt: '', mime }, AT),
    ).toBe(`clipboard-20261025-120304.${ext}`)
  })

  test('文字は txt', () => {
    expect(slotFileName({ kind: 'text', bytes: 1, updatedAt: '', text: 'a' }, AT)).toBe(
      'clipboard-20261025-120304.txt',
    )
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

  test('ファイルのメタを読む (mime が付き、text は付かない)', () => {
    expect(
      parseSlotMeta({
        kind: 'image',
        bytes: 10,
        updatedAt: '2026-10-25T12:00:00.000Z',
        mime: 'image/png',
      }),
    ).toEqual({ kind: 'image', bytes: 10, updatedAt: '2026-10-25T12:00:00.000Z', mime: 'image/png' })
  })

  test.each(['video', 'audio', 'pdf', 'textfile'])('%s も読む', (kind) => {
    expect(
      parseSlotMeta({ kind, bytes: 1, updatedAt: 'x', mime: 'application/x' }),
    ).toMatchObject({ kind })
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
    { kind: 'image', bytes: 1, updatedAt: 'x' },
    { kind: 'video', bytes: 1, updatedAt: 'x', mime: 5 },
    { kind: 'text', bytes: 1, updatedAt: 'x' },
  ])('知らない形は null に畳む: %j', (value) => {
    expect(parseSlotMeta(value)).toBeNull()
  })
})
