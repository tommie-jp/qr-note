import { crc32, createDeflate } from 'node:zlib'
import sharp from 'sharp'
import { describe, expect, test, vi } from 'vitest'
import { MAX_INPUT_PIXELS } from '../images/thumbConfig'

// 解凍爆弾よけの回帰テスト (2026-11 のセキュリティ監査 HIGH)。
// 埋め込みのモデルは重いので embed() を差し替え、「巨大な画像では呼ばれない」
// ことだけを見る。prisma も要らない (computeEmbeddingBytes は DB に触らない)
const { embedMock } = vi.hoisted(() => ({
  embedMock: vi.fn(async () => new Float32Array([1, 0, 0, 0])),
}))
vi.mock('./embedder', () => ({ embed: embedMock }))
vi.mock('../db', () => ({ prisma: {} }))

const { computeEmbeddingBytes, isWithinEmbeddingPixelLimit } = await import(
  './embedImageServer'
)

// 解凍爆弾そのもの: 全画素が 0 のグレー 8bit PNG。IDAT は「0 を並べたもの」を
// deflate した数百 KB で、width x height を名乗る。sharp で作ると展開後の
// 画素 (16000x16000 なら 768MB) をこのテスト自身が確保してしまうので、
// 画素を一度もメモリに置かずに zlib へ流し込んで組む
async function bombPng(width: number, height: number): Promise<Uint8Array> {
  const chunk = (type: string, data: Buffer): Buffer => {
    const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(typeAndData))
    return Buffer.concat([length, typeAndData, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 0 // grayscale
  // 1 行 = フィルタ種別 1 バイト + 画素 width バイト。どちらも 0
  const idat = await deflateZeros((width + 1) * height)
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', idat),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  )
}

// total バイトの 0 を deflate する。1MB の同じ緩衝を繰り返し書くので、
// 展開後の大きさに関わらずテストのメモリは一定
async function deflateZeros(total: number): Promise<Buffer> {
  const deflate = createDeflate({ level: 9 })
  const out: Buffer[] = []
  deflate.on('data', (piece: Buffer) => out.push(piece))
  const finished = new Promise<void>((resolve, reject) => {
    deflate.on('end', resolve)
    deflate.on('error', reject)
  })
  const zeros = Buffer.alloc(1 << 20)
  let remaining = total
  while (remaining > 0) {
    const n = Math.min(zeros.length, remaining)
    if (!deflate.write(zeros.subarray(0, n))) {
      await new Promise<void>((resolve) => deflate.once('drain', resolve))
    }
    remaining -= n
  }
  deflate.end()
  await finished
  return Buffer.concat(out)
}

// 16000x16000 = 256MP。サムネ (50MP) は断るが、transformers.js 既定の約 268MP には
// 収まるので、門が無いと 768MB 級を 2 回展開する。作るのは 1 回でよい
const BOMB_SIDE = 16000
const bomb = bombPng(BOMB_SIDE, BOMB_SIDE)

async function smallPng(): Promise<Uint8Array> {
  const buffer = await sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .png()
    .toBuffer()
  return new Uint8Array(buffer)
}

describe('isWithinEmbeddingPixelLimit', () => {
  test('accepts an ordinary image', async () => {
    expect(await isWithinEmbeddingPixelLimit(await smallPng())).toBe(true)
  })

  test('rejects a decompression bomb whose declared size exceeds MAX_INPUT_PIXELS', async () => {
    const bytes = await bomb
    // 爆弾は小さい (バイト数の上限 10MB では防げない) のに、展開後は上限超え
    expect(bytes.byteLength).toBeLessThan(1_000_000)
    expect(BOMB_SIDE * BOMB_SIDE).toBeGreaterThan(MAX_INPUT_PIXELS)

    expect(await isWithinEmbeddingPixelLimit(bytes)).toBe(false)
  })

  test('rejects bytes that are not an image', async () => {
    await expect(isWithinEmbeddingPixelLimit(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow()
  })

  test('uses the same ceiling as the thumbnail (MAX_INPUT_PIXELS)', async () => {
    // 上限ちょうど下は通し、1 行足すと断る
    const side = Math.floor(Math.sqrt(MAX_INPUT_PIXELS))
    expect(await isWithinEmbeddingPixelLimit(await bombPng(side, side))).toBe(true)
    expect(await isWithinEmbeddingPixelLimit(await bombPng(side, side + 1))).toBe(false)
  })
})

describe('computeEmbeddingBytes', () => {
  test('does not hand a decompression bomb to the model', async () => {
    embedMock.mockClear()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(await computeEmbeddingBytes(await bomb, 'image/png')).toBeNull()

    // ここが要点: 展開 (embed → sharp(limit なし)) が一度も走っていない。
    // 断ったのは画素数の門であって、読み込みの失敗ではない
    expect(embedMock).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('画素数が上限'))
    warn.mockRestore()
  })

  test('still embeds an ordinary image', async () => {
    embedMock.mockClear()

    const bytes = await computeEmbeddingBytes(await smallPng(), 'image/png')

    expect(embedMock).toHaveBeenCalledTimes(1)
    expect(bytes).not.toBeNull()
    expect(bytes!.byteLength).toBeGreaterThan(0)
  })

  test('returns null instead of throwing for bytes that are not an image', async () => {
    embedMock.mockClear()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await computeEmbeddingBytes(new Uint8Array([1, 2, 3, 4]), 'image/png')).toBeNull()
    expect(embedMock).not.toHaveBeenCalled()
    error.mockRestore()
  })
})
