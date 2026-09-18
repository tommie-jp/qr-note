import { describe, expect, test } from 'vitest'
import { PhotoMetaFormatError } from '@/lib/images/photoMeta/types'
import { ascii, concat, containsAscii } from '@/test/photoFixtures'
import { stripVideoMeta } from './videoMeta'

// ISO-BMFF の箱を手で組む。再生できる必要はなく、箱の並びと位置が
// 保たれることを見る (再生できることは ffmpeg で別に確かめた。docs/97 §10)
function rawBox(type: ArrayLike<number>, ...parts: ArrayLike<number>[]): Uint8Array<ArrayBuffer> {
  const out = concat([new Uint8Array(4), type, concat(parts)])
  new DataView(out.buffer).setUint32(0, out.byteLength)
  return out
}

// 型の "©" は latin1 の 0xA9 (ascii() がそのまま 1 バイトにする)
const box = (type: string, ...parts: ArrayLike<number>[]) => rawBox(ascii(type), ...parts)

function u32(value: number): number[] {
  return [value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
}

// mvhd / tkhd / mdhd の頭 (版 0: 作成・更新が 32 ビット、版 1: 64 ビット)
function timedHeader(type: string, version: 0 | 1, created: number, rest = 16): Uint8Array<ArrayBuffer> {
  const times =
    version === 0
      ? [...u32(created), ...u32(created)]
      : [0, 0, 0, 0, ...u32(created), 0, 0, 0, 0, ...u32(created)]
  return box(type, [version, 0, 0, 0], times, new Uint8Array(rest).fill(0x11))
}

// QuickTime の鍵と値 (iPhone の moov/meta): hdlr(mdta) + keys + ilst
function appleMeta(entries: Array<[string, string]>): Uint8Array<ArrayBuffer> {
  const hdlr = box('hdlr', new Uint8Array(8), ascii('mdta'), new Uint8Array(12), [0])
  const keys = box(
    'keys',
    [0, 0, 0, 0],
    u32(entries.length),
    ...entries.map(([key]) => box('mdta', ascii(key))),
  )
  // 値の箱の型は「鍵の番号 (1 始まり)」
  const ilst = box(
    'ilst',
    ...entries.map(([, value], i) =>
      rawBox(u32(i + 1), box('data', [0, 0, 0, 1, 0, 0, 0, 0], ascii(value))),
    ),
  )
  return box('meta', hdlr, keys, ilst)
}

const XMP_UUID = [
  0xbe, 0x7a, 0xcf, 0xcb, 0x97, 0xa9, 0x42, 0xe8, 0x9c, 0x71, 0x99, 0x94, 0x91, 0xe3, 0xaf, 0xac,
]

const MDAT = box('mdat', ascii('PIXELS-AND-SAMPLES'))
const STCO = box('stco', [0, 0, 0, 0], u32(1), u32(40))

function movie(...moovChildren: Uint8Array[]): Uint8Array<ArrayBuffer> {
  return concat([box('ftyp', ascii('qt  '), u32(0), ascii('qt  ')), box('moov', ...moovChildren), MDAT])
}

function track(...extra: Uint8Array[]): Uint8Array<ArrayBuffer> {
  return box(
    'trak',
    timedHeader('tkhd', 0, 0),
    box('mdia', timedHeader('mdhd', 0, 0), box('minf', box('stbl', STCO))),
    ...extra,
  )
}

function typesIn(bytes: Uint8Array): string[] {
  const text = Buffer.from(bytes).toString('latin1')
  return ['udta', 'meta', 'free', 'uuid', '©xyz'].filter((type) => text.includes(type))
}

describe('stripVideoMeta', () => {
  test('moov の udta (位置・機種・日時) を同じ長さの free にして中身を消す', () => {
    // Arrange
    const udta = box(
      'udta',
      box('©xyz', [0, 0x11, 0x15, 0xc7], ascii('+35.6812+139.7671/')),
      box('©mak', [0, 0x0b, 0, 0], ascii('QRNOTE-CAM')),
      box('©day', [0, 0x0a, 0, 0], ascii('2026:09:19')),
    )
    const input = movie(timedHeader('mvhd', 0, 0), track(), udta)

    // Act
    const { bytes, removed } = stripVideoMeta(input)

    // Assert
    expect(bytes.byteLength).toBe(input.byteLength)
    expect(containsAscii(bytes, '+35.6812')).toBe(false)
    expect(containsAscii(bytes, 'QRNOTE-CAM')).toBe(false)
    expect(typesIn(bytes)).toEqual(['free'])
    expect(removed).toEqual(new Set(['gps', 'camera', 'datetime']))
    // 箱の外 (位置表・画素) は 1 バイトも変えない
    const udtaAt = Buffer.from(input).indexOf(Buffer.from(udta))
    expect(bytes.subarray(0, udtaAt)).toEqual(input.subarray(0, udtaAt))
    expect(bytes.subarray(udtaAt + udta.byteLength)).toEqual(input.subarray(udtaAt + udta.byteLength))
  })

  test('iPhone の鍵と値 (moov/meta) を消し、何の情報だったかを数える', () => {
    const input = movie(
      timedHeader('mvhd', 0, 0),
      track(),
      appleMeta([
        ['com.apple.quicktime.location.ISO6709', '+35.6812+139.7671+040.000/'],
        ['com.apple.quicktime.make', 'Apple'],
        ['com.apple.quicktime.model', 'iPhone 15'],
        ['com.apple.quicktime.creationdate', '2026-09-19T10:00:00+0900'],
        ['com.apple.quicktime.software', '26.0'],
      ]),
    )

    const { bytes, removed } = stripVideoMeta(input)

    expect(containsAscii(bytes, 'ISO6709')).toBe(false)
    expect(containsAscii(bytes, 'iPhone 15')).toBe(false)
    expect(removed).toEqual(new Set(['gps', 'camera', 'datetime', 'other']))
  })

  test('トラックの udta・XMP の uuid も消す', () => {
    const xmp = box('uuid', XMP_UUID, ascii('<x:xmpmeta>SECRET-OWNER</x:xmpmeta>'))
    const input = concat([
      movie(timedHeader('mvhd', 0, 0), track(box('udta', box('name', ascii('SECRET-OWNER'))))),
      xmp,
    ])

    const { bytes, removed } = stripVideoMeta(input)

    expect(containsAscii(bytes, 'SECRET-OWNER')).toBe(false)
    expect(removed).toEqual(new Set(['other', 'xmp']))
  })

  test('mvhd / tkhd / mdhd の作成・更新日時を 0 にする (版 0 と版 1)', () => {
    // Arrange: 2026-09-19 ごろ (1904 年起点の秒)
    const created = 3_841_000_000
    const input = movie(
      timedHeader('mvhd', 1, created),
      box(
        'trak',
        timedHeader('tkhd', 0, created),
        box('mdia', timedHeader('mdhd', 1, created), box('minf', box('stbl', STCO))),
      ),
    )

    // Act
    const { bytes, removed } = stripVideoMeta(input)

    // Assert
    expect(removed).toEqual(new Set(['datetime']))
    const hex = Buffer.from(bytes).toString('hex')
    expect(hex.includes(Buffer.from(u32(created)).toString('hex'))).toBe(false)
    // 日時の後ろ (尺・倍率など) はそのまま
    expect(Buffer.from(bytes).includes(Buffer.alloc(16, 0x11))).toBe(true)
  })

  test('撮影情報が無ければ入力をそのまま返す', () => {
    const input = movie(timedHeader('mvhd', 0, 0), track())

    const result = stripVideoMeta(input)

    expect(result.bytes).toBe(input)
    expect(result.removed.size).toBe(0)
  })

  test('2 回掛けても同じ (冪等)', () => {
    const input = movie(
      timedHeader('mvhd', 0, 12345),
      track(),
      box('udta', box('©xyz', ascii('+35.6812+139.7671/'))),
    )

    const once = stripVideoMeta(input)
    const twice = stripVideoMeta(once.bytes)

    expect(twice.bytes).toBe(once.bytes)
    expect(twice.removed.size).toBe(0)
  })

  test('moov の中の並びが壊れていれば PhotoMetaFormatError', () => {
    const brokenMoov = box('moov', timedHeader('mvhd', 0, 0), [0, 0, 0, 0x7f, 0x75, 0x64])
    const input = concat([box('ftyp', ascii('isom')), brokenMoov, MDAT])

    expect(() => stripVideoMeta(input)).toThrow(PhotoMetaFormatError)
  })

  // 入れ子を数千段重ねるとスタックが溢れて RangeError になる (レビューで 8000 段を
  // 確認)。呼ぶ側は何の例外でも断るので漏れはしないが、型の決まった失敗にそろえる
  test('入れ子が深すぎる箱は PhotoMetaFormatError', () => {
    let nested: Uint8Array<ArrayBuffer> = box('mdia')
    for (let i = 0; i < 8000; i++) {
      nested = box('trak', nested)
    }
    const input = concat([box('ftyp', ascii('isom')), box('moov', nested), MDAT])

    expect(() => stripVideoMeta(input)).toThrow(PhotoMetaFormatError)
  })

  test('moov が無い (動画ではない) なら PhotoMetaFormatError', () => {
    expect(() => stripVideoMeta(concat([box('ftyp', ascii('isom')), MDAT]))).toThrow(
      PhotoMetaFormatError,
    )
  })
})
