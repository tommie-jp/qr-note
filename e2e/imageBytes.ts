import { crc32, deflateSync } from 'node:zlib'

// お絵かきの E2E (draw.spec.ts) が使う、画像のバイト列の道具。
//
// 書き出しは「横取りした送信本文のヘッダから寸法と形式を読む」で判定する
// (docs/96-シークレット・お絵かきのテスト計画.md §3-3)。画素そのものは
// Chromium の版でずれるので見ない

export interface ImageInfo {
  mime: 'image/png' | 'image/webp'
  width: number
  height: number
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

// PNG / WebP のヘッダから形式と寸法を読む。どちらでもなければ投げる
export function readImageInfo(bytes: Buffer): ImageInfo {
  if (bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    // 署名の直後の最初のチャンクが IHDR。幅・高さは big endian
    return { mime: 'image/png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  }
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return { mime: 'image/webp', ...readWebpSize(bytes) }
  }
  throw new Error(`PNG でも WebP でもない: ${bytes.subarray(0, 16).toString('hex')}`)
}

// WebP の最初のチャンクは 3 通り。Chromium の toBlob は非可逆なら 'VP8 '、
// 透過などの拡張があれば 'VP8X' を出す
function readWebpSize(bytes: Buffer): { width: number; height: number } {
  const chunk = bytes.toString('ascii', 12, 16)
  switch (chunk) {
    case 'VP8 ':
      // フレームタグ 3 バイト + 開始コード 3 バイトの後に、幅・高さが 14 bit ずつ
      return {
        width: bytes.readUInt16LE(26) & 0x3fff,
        height: bytes.readUInt16LE(28) & 0x3fff,
      }
    case 'VP8L': {
      // 署名 1 バイトの後に (幅 - 1)・(高さ - 1) が 14 bit ずつ
      const bits = bytes.readUInt32LE(21)
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
    case 'VP8X':
      // フラグ 4 バイトの後に (幅 - 1)・(高さ - 1) が 24 bit ずつ
      return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 }
    default:
      throw new Error(`知らない WebP のチャンク: ${chunk}`)
  }
}

export interface FormFilePart {
  contentType: string
  bytes: Buffer
}

const HEADER_END = Buffer.from('\r\n\r\n')
const CRLF_LENGTH = 2

// multipart/form-data の本文から、その名前の欄を取り出す
// (アップロードは FormData の "file" 欄。components/editor/uploadImageXhr.ts)
export function formFilePart(body: Buffer, contentTypeHeader: string, field: string): FormFilePart {
  const boundary = /boundary=(?:"([^"]+)"|([^;\s]+))/.exec(contentTypeHeader)
  if (!boundary) {
    throw new Error(`multipart の境界が無い: ${contentTypeHeader}`)
  }
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`)
  const namePattern = new RegExp(`;\\s*name="${field}"`)

  let start = body.indexOf(delimiter)
  while (start !== -1) {
    const next = body.indexOf(delimiter, start + delimiter.length)
    if (next === -1) {
      break
    }
    // 区切りの直後の CRLF と、次の区切りの直前の CRLF は中身ではない
    const part = body.subarray(start + delimiter.length + CRLF_LENGTH, next - CRLF_LENGTH)
    const headerEnd = part.indexOf(HEADER_END)
    const headers = part.toString('utf8', 0, headerEnd)
    if (headerEnd !== -1 && namePattern.test(headers)) {
      const type = /content-type:\s*([^\r\n]+)/i.exec(headers)
      return {
        contentType: type?.[1].trim() ?? '',
        bytes: part.subarray(headerEnd + HEADER_END.length),
      }
    }
    start = next
  }
  throw new Error(`multipart に ${field} 欄が無い`)
}

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

const PNG_BIT_DEPTH = 8
const PNG_COLOR_TYPE_RGB = 2
const RGB_CHANNELS = 3

// 1 色で塗った RGB の PNG。下敷きの画像として route で配る
export function solidPng(
  width: number,
  height: number,
  rgb: readonly [number, number, number],
): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = PNG_BIT_DEPTH
  header[9] = PNG_COLOR_TYPE_RGB
  // 行ごとに先頭 1 バイトのフィルタ種別 (0 = なし) + 画素
  const row = Buffer.alloc(1 + width * RGB_CHANNELS)
  for (let x = 0; x < width; x += 1) {
    row.set(rgb, 1 + x * RGB_CHANNELS)
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}
