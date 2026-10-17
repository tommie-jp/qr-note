import { expect, test } from 'vitest'
import {
  formatOcrQuote,
  imageAtCursor,
  imagesWithoutOcr,
  ocrInsertion,
  ocrPlaceholder,
} from './ocrQuote'

test('複数行を引用ブロックへ整形する', () => {
  expect(formatOcrQuote('冷却ファン\nDC FAN 40mm')).toBe(
    '> 冷却ファン\n> DC FAN 40mm',
  )
})

test('行の配列でも受ける', () => {
  expect(formatOcrQuote(['12V', '0.1A'])).toBe('> 12V\n> 0.1A')
})

test('整形時に日本語優先の正規化がかかる', () => {
  expect(formatOcrQuote('单体')).toBe('> 単体')
})

test('前後の空白を落とし、空行は捨てる', () => {
  expect(formatOcrQuote('  上  \n\n  下  ')).toBe('> 上\n> 下')
})

test('中身が無ければ空文字 (見つからなかったの合図)', () => {
  expect(formatOcrQuote('')).toBe('')
  expect(formatOcrQuote('   \n  ')).toBe('')
  expect(formatOcrQuote([])).toBe('')
})

test('プレースホルダは連番で一意になり、引用行の体裁を持つ', () => {
  expect(ocrPlaceholder(1)).not.toBe(ocrPlaceholder(2))
  expect(ocrPlaceholder(1).startsWith('> ')).toBe(true)
})

test('差し込みは画像行との間に空行を空ける', () => {
  expect(ocrInsertion('> x')).toBe('\n\n> x')
})

const IMG_A = '![](/api/images/aaaaaaaa-0000-0000-0000-000000000000.jpg)'
const IMG_B = '![](/api/images/bbbbbbbb-0000-0000-0000-000000000000.png)'

test('カーソルが画像記法の内側ならその画像を選ぶ', () => {
  const doc = `前文 ${IMG_A} 後文`
  const inside = doc.indexOf(IMG_A) + 5
  const hit = imageAtCursor(doc, inside)
  expect(hit?.url).toBe('/api/images/aaaaaaaa-0000-0000-0000-000000000000.jpg')
  expect(hit?.insertAt).toBe(doc.indexOf(IMG_A) + IMG_A.length)
})

test('内側でなければ手前の直近画像を選ぶ', () => {
  const doc = `${IMG_A}\n\n${IMG_B}\n\nここにカーソル`
  const cursor = doc.indexOf('ここに')
  expect(imageAtCursor(doc, cursor)?.url).toContain('bbbbbbbb')
})

test('手前に無ければ後ろの直近画像を選ぶ', () => {
  const doc = `冒頭にカーソル\n\n${IMG_A}`
  expect(imageAtCursor(doc, 0)?.url).toContain('aaaaaaaa')
})

test('外部画像は対象外', () => {
  const doc = '![](https://example.com/x.jpg)'
  expect(imageAtCursor(doc, 5)).toBeNull()
})

test('画像が無ければ null', () => {
  expect(imageAtCursor('ただのテキスト', 3)).toBeNull()
})

// 音声・PDF も画像記法で本文に入る (41-QR-search/docs/12-添付ファイル種類拡張メモ.md)。
// OCR できるのは画像だけなので、「後から OCR」の候補から外す
test.each([
  '![audio](/api/images/cccccccc-0000-0000-0000-000000000000.mp3)',
  '![audio](/api/images/cccccccc-0000-0000-0000-000000000000.m4a)',
  '![audio](/api/images/cccccccc-0000-0000-0000-000000000000.wav)',
  '![仕様書.pdf](/api/images/cccccccc-0000-0000-0000-000000000000.pdf)',
])('画像でない添付は OCR 対象にしない: %s', (markup) => {
  expect(imageAtCursor(markup, 5)).toBeNull()
})

test('音声・PDF に挟まれていても画像だけを選ぶ', () => {
  const audio = '![audio](/api/images/cccccccc-0000-0000-0000-000000000000.mp3)'
  const doc = `${audio}\n\n${IMG_A}\n\nここにカーソル`
  expect(imageAtCursor(doc, doc.indexOf('ここに'))?.url).toContain('aaaaaaaa')
})

// ---------------------------------------------------------------------------
// imagesWithoutOcr (docs/106-OCR切替と全画像OCR計画.md §2)

const OWN_A = '![](/api/images/aaaaaaaa-0000-0000-0000-00000000000a.png)'
const OWN_B = '![](/api/images/bbbbbbbb-0000-0000-0000-00000000000b.webp)'

test('imagesWithoutOcr: 直後に引用が無い自前画像だけを、本文の順に返す', () => {
  // Arrange
  const doc = `${OWN_A}\n\n> 読めた文字\n\n${OWN_B}\n\n続きの文`

  // Act
  const hits = imagesWithoutOcr(doc)

  // Assert
  expect(hits.map((h) => h.url)).toEqual([
    '/api/images/bbbbbbbb-0000-0000-0000-00000000000b.webp',
  ])
  expect(hits[0].insertAt).toBe(doc.indexOf(OWN_B) + OWN_B.length)
})

test('imagesWithoutOcr: 空行を挟まず直後の行が引用でも済みとみなす', () => {
  expect(imagesWithoutOcr(`${OWN_A}\n> 読めた文字`)).toEqual([])
})

test('imagesWithoutOcr: 処理中のプレースホルダが付いた画像も飛ばす', () => {
  const doc = `${OWN_A}${ocrInsertion(ocrPlaceholder(7))}`
  expect(imagesWithoutOcr(doc)).toEqual([])
})

test('imagesWithoutOcr: 空行を 2 つ以上挟んだ引用は別のものとみなす', () => {
  expect(imagesWithoutOcr(`${OWN_A}\n\n\n> 離れた引用`)).toHaveLength(1)
})

test('imagesWithoutOcr: 本文の末尾の画像も拾う', () => {
  expect(imagesWithoutOcr(`前置き\n${OWN_A}`)).toHaveLength(1)
})

test('imagesWithoutOcr: 外部画像・音声・PDF の添付は対象外', () => {
  // Arrange
  const doc = [
    '![](https://example.com/x.png)',
    '![audio](/api/images/cccccccc-0000-0000-0000-00000000000c.mp3)',
    '![仕様書.pdf](/api/images/dddddddd-0000-0000-0000-00000000000d.pdf)',
  ].join('\n\n')

  // Act / Assert
  expect(imagesWithoutOcr(doc)).toEqual([])
})

test('imagesWithoutOcr: 画像が無ければ空', () => {
  expect(imagesWithoutOcr('文字だけのノート')).toEqual([])
})

test('imagesWithoutOcr: コードブロックの中の画像記法は対象外 (例として書いた記法)', () => {
  // Arrange
  const doc = ['```markdown', OWN_A, '```', '', '~~~', OWN_B, '~~~', '', OWN_B].join('\n')

  // Act
  const hits = imagesWithoutOcr(doc)

  // Assert: フェンスの外の最後の 1 枚だけ
  expect(hits).toHaveLength(1)
  expect(hits[0].insertAt).toBe(doc.length)
})

test('imagesWithoutOcr: 引用の中の画像は対象外 (直後に差すと引用が混ざる)', () => {
  expect(imagesWithoutOcr(`> ${OWN_A}\n> 説明`)).toEqual([])
})
