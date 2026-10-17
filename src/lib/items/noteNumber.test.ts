import QRCode from 'qrcode'
import { describe, expect, test } from 'vitest'
import {
  buildShortItemUrl,
  firstFreeNoteNumber,
  hasNoteNumber,
  isNoteNumber,
  NOTE_NUMBER_SQL_PATTERN,
  noteNumberOf,
} from './noteNumber'

describe('isNoteNumber', () => {
  test.each(['1000', '1234', '9999'])('%s は番号', (tag) => {
    expect(isNoteNumber(tag)).toBe(true)
  })

  test.each(['999', '10000', '0123', '9784873115658', 'wb01', '100x', '12a4', ''])(
    '%s は番号でない',
    (tag) => {
      expect(isNoteNumber(tag)).toBe(false)
    },
  )

  test('SQL の正規表現と同じ集合を表す', () => {
    const sql = new RegExp(NOTE_NUMBER_SQL_PATTERN)
    for (const tag of ['999', '1000', '9999', '10000', '0123', 'wb01']) {
      expect(sql.test(tag)).toBe(isNoteNumber(tag))
    }
  })
})

describe('noteNumberOf', () => {
  test('番号タグがちょうど 1 つならそれを返す', () => {
    expect(noteNumberOf(['部品', '1234', 'wb01-03-08'])).toBe('1234')
  })

  test('番号タグが無ければ null', () => {
    expect(noteNumberOf(['部品', '9784873115658'])).toBeNull()
  })

  test('番号タグが 2 つあると決まらないので null', () => {
    expect(noteNumberOf(['1234', '2026'])).toBeNull()
  })
})

describe('hasNoteNumber', () => {
  test('番号タグが 1 つでも 2 つでも真', () => {
    expect(hasNoteNumber(['部品', '1234'])).toBe(true)
    expect(hasNoteNumber(['1234', '2026'])).toBe(true)
  })

  test('番号タグが無ければ偽', () => {
    expect(hasNoteNumber(['部品', 'wb01-03-08', '9784873115658'])).toBe(false)
  })
})

describe('firstFreeNoteNumber', () => {
  test('何も使われていなければ 1000', () => {
    expect(firstFreeNoteNumber([])).toBe('1000')
  })

  test('欠番があれば一番小さい欠番を返す', () => {
    expect(firstFreeNoteNumber(['1000', '1001', '1003', 'book'])).toBe('1002')
  })

  test('番号でないタグは数えない', () => {
    expect(firstFreeNoteNumber(['0999', '999', '10000', '9784873115658'])).toBe('1000')
  })

  test('9999 まで埋まっていれば null', () => {
    const all = Array.from({ length: 9000 }, (_, i) => String(1000 + i))
    expect(firstFreeNoteNumber(all)).toBeNull()
  })
})

describe('buildShortItemUrl', () => {
  test('起点に /s/<番号> を付ける', () => {
    expect(buildShortItemUrl('https://qr.tommie.jp', '1234')).toBe('https://qr.tommie.jp/s/1234')
  })

  test('本番の起点なら QR は版 2 (25x25) に収まる (docs/111 §1)', () => {
    const url = buildShortItemUrl('https://qr.tommie.jp', '9999')
    expect(QRCode.create(url, { errorCorrectionLevel: 'M' }).version).toBe(2)
  })

  test('起点の末尾の / は 1 つにまとめる', () => {
    expect(buildShortItemUrl('https://qr.tommie.jp//', '1234')).toBe('https://qr.tommie.jp/s/1234')
  })
})
