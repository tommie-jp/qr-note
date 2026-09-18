import sharp from 'sharp'
import { describe, expect, test } from 'vitest'
import { ascii, concat, containsAscii, makeAnimation, rawPixels } from '@/test/photoFixtures'
import { stripGif } from './gif'
import { PhotoMetaFormatError } from './types'

// 中身を 255 バイト以下の小区画に割って並べ、0 で閉じる
function subBlocks(data: Uint8Array): number[] {
  const out: number[] = []
  for (let at = 0; at < data.byteLength; at += 255) {
    const piece = data.subarray(at, at + 255)
    out.push(piece.byteLength, ...piece)
  }
  out.push(0)
  return out
}

const commentExtension = (text: string) => concat([[0x21, 0xfe], subBlocks(ascii(text))])

function appExtension(identifier: string, data: string): Uint8Array<ArrayBuffer> {
  return concat([[0x21, 0xff, 0x0b], ascii(identifier), subBlocks(ascii(data))])
}

// 大域の色表の終わり (最初の拡張・画像が始まる位置)
function tableEnd(gif: Uint8Array): number {
  const packed = gif[10]
  return 13 + (packed & 0x80 ? 3 * 2 ** ((packed & 0x07) + 1) : 0)
}

// 大域の色表の直後に差し込む
function insertBlocks(gif: Uint8Array, ...blocks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const at = tableEnd(gif)
  return concat([gif.subarray(0, at), ...blocks, gif.subarray(at)])
}

describe('stripGif', () => {
  test('コメント・XMP・知らないアプリ拡張を落とし、ループ指定とコマは残す', async () => {
    // Arrange
    const plain = await makeAnimation('gif')
    const input = insertBlocks(
      plain,
      commentExtension('SECRET-OWNER'),
      appExtension('XMP DataXMP', '<x>SECRET-OWNER</x>'),
      appExtension('MGK8BIM0000', 'SECRET-OWNER'),
    )

    // Act
    const { bytes, removed } = stripGif(input)

    // Assert
    expect(containsAscii(bytes, 'SECRET-OWNER')).toBe(false)
    expect(containsAscii(bytes, 'NETSCAPE2.0')).toBe(true)
    expect(removed).toEqual(new Set(['comment', 'xmp', 'other']))
    expect(bytes).toEqual(plain)
    const meta = await sharp(bytes, { animated: true }).metadata()
    expect(meta.pages).toBe(2)
    expect(await rawPixels(bytes)).toEqual(await rawPixels(plain))
  })

  test('終端 (0x3B) より後ろの付け足しを落とす', async () => {
    const plain = await makeAnimation('gif')

    const { bytes, removed } = stripGif(concat([plain, ascii('SECRET-OWNER')]))

    expect(bytes).toEqual(plain)
    expect(removed).toEqual(new Set(['trailer']))
  })

  test('撮影情報が無ければ入力をそのまま返す', async () => {
    const input = await makeAnimation('gif')

    const result = stripGif(input)

    expect(result.bytes).toBe(input)
    expect(result.removed.size).toBe(0)
  })

  test('壊れた並びは PhotoMetaFormatError', async () => {
    const plain = await makeAnimation('gif')
    const cases = [
      // 署名が違う
      concat([ascii('GIF90a'), plain.subarray(6)]),
      // 小区画の途中で切れている
      insertBlocks(plain, new Uint8Array([0x21, 0xfe, 0x40, 0x41])).subarray(0, tableEnd(plain) + 4),
      // 知らない区画の印
      insertBlocks(plain, new Uint8Array([0x99])),
      // 終端に届かない
      plain.subarray(0, plain.byteLength - 1),
    ]

    for (const input of cases) {
      expect(() => stripGif(new Uint8Array(input))).toThrow(PhotoMetaFormatError)
    }
  })
})
