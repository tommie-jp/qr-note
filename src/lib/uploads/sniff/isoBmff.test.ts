import { describe, expect, test } from 'vitest'
import { box, concatBytes, ftypBox, hdlrBox } from './__fixtures__/media'
import { findTopLevelBox, handlerTypesIn, readIsoBmffBrands } from './isoBmff'

const text = (bytes: Uint8Array | null) =>
  bytes === null ? null : new TextDecoder('latin1').decode(bytes)

describe('readIsoBmffBrands', () => {
  test('major brand と compatible brands を並びのまま返す', () => {
    expect(readIsoBmffBrands(ftypBox('mif1', ['mif1', 'heic']))).toEqual([
      'mif1',
      'mif1',
      'heic',
    ])
  })

  test('ftyp でない・12 バイトに満たない入力は null', () => {
    expect(readIsoBmffBrands(box('moov', new Uint8Array(8)))).toBeNull()
    expect(readIsoBmffBrands(ftypBox('heic', []).subarray(0, 11))).toBeNull()
  })

  test('ボックス長の外にある brand は読まない', () => {
    // Arrange: ftyp (compatible 1 個) の直後に別のボックスが続く
    const bytes = concatBytes([
      ftypBox('isom', ['mp42']),
      box('free', new TextEncoder().encode('avif')),
    ])

    // Act
    const brands = readIsoBmffBrands(bytes)

    // Assert
    expect(brands).toEqual(['isom', 'mp42'])
  })
})

describe('findTopLevelBox', () => {
  test('トップレベルの並びから型の一致する箱の中身を返す', () => {
    const bytes = concatBytes([
      box('ftyp', new TextEncoder().encode('isom')),
      box('moov', new TextEncoder().encode('body')),
    ])

    expect(text(findTopLevelBox(bytes, 'moov'))).toBe('body')
    expect(findTopLevelBox(bytes, 'mdat')).toBeNull()
  })

  test('長さ 1 は 64bit 拡張長として読む', () => {
    // Arrange: [1][type][64bit 長さ][中身]
    const payload = new TextEncoder().encode('large')
    const large = new Uint8Array(16 + payload.byteLength)
    const view = new DataView(large.buffer)
    view.setUint32(0, 1)
    large.set(new TextEncoder().encode('mdat'), 4)
    view.setBigUint64(8, BigInt(large.byteLength))
    large.set(payload, 16)
    const bytes = concatBytes([large, box('moov', new TextEncoder().encode('tail'))])

    // Act / Assert
    expect(text(findTopLevelBox(bytes, 'mdat'))).toBe('large')
    expect(text(findTopLevelBox(bytes, 'moov'))).toBe('tail')
  })

  test('長さ 0 は「ファイル末尾まで」', () => {
    const last = box('moov', new TextEncoder().encode('rest'))
    new DataView(last.buffer).setUint32(0, 0)

    expect(text(findTopLevelBox(last, 'moov'))).toBe('rest')
  })

  test('進めない壊れた長さでは throw せず諦める', () => {
    const broken = box('free', new Uint8Array(4))
    new DataView(broken.buffer).setUint32(0, 4) // ヘッダ (8) より短い

    expect(() => findTopLevelBox(broken, 'moov')).not.toThrow()
    expect(findTopLevelBox(broken, 'moov')).toBeNull()
    expect(findTopLevelBox(new Uint8Array(7), 'moov')).toBeNull()
  })
})

test('handlerTypesIn は入れ子の hdlr から handler を出現順に集める', () => {
  const moov = concatBytes([
    box('trak', box('mdia', hdlrBox('vide'))),
    box('trak', box('mdia', hdlrBox('soun'))),
  ])

  expect(handlerTypesIn(moov)).toEqual(['vide', 'soun'])
  expect(handlerTypesIn(new Uint8Array(0))).toEqual([])
})
