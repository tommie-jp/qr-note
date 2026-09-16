import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { prepareSecretImage } from './image'

// 断片に貼る画像の下ごしらえ (docs/51-部分暗号化計画.md §9)。
// canvas の描き直し (images/imageCanvas) は document が要るので差し替え、
// 渡す指定と、戻った Blob の型の確かめ方だけを固定する
const mocks = vi.hoisted(() => ({
  redrawImage: vi.fn<(source: Blob, options: unknown) => Promise<Blob>>(),
}))

vi.mock('../images/imageCanvas', () => ({
  redrawImage: mocks.redrawImage,
}))

const PIXELS = new Uint8Array([0x52, 0x49, 0x46, 0x46, 9, 8, 7])

const file = () => new File([new Uint8Array([1, 2, 3])], 'photo.heic', { type: 'image/heic' })

function redrawn(type: string): void {
  mocks.redrawImage.mockResolvedValueOnce(new Blob([PIXELS], { type }))
}

beforeEach(() => {
  mocks.redrawImage.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('prepareSecretImage', () => {
  test('WebP・品質 0.9・長辺 2048 で描き直させる', async () => {
    // Arrange
    redrawn('image/webp')
    const source = file()

    // Act
    await prepareSecretImage(source)

    // Assert
    expect(mocks.redrawImage).toHaveBeenCalledTimes(1)
    expect(mocks.redrawImage).toHaveBeenCalledWith(source, {
      type: 'image/webp',
      quality: 0.9,
      maxEdge: 2048,
    })
  })

  test('戻った Blob の型とバイト列をそのまま返す', async () => {
    redrawn('image/webp')

    const image = await prepareSecretImage(file())

    expect(image.mime).toBe('image/webp')
    expect(Array.from(image.bytes)).toEqual(Array.from(PIXELS))
  })

  // 古い iOS Safari は WebP を書き出せず、canvas が黙って PNG を返す。
  // PNG は許される型なので、大きくなるだけで保存はできる
  test('canvas が PNG に落としても通る (実際の型で申告する)', async () => {
    redrawn('image/png')

    const image = await prepareSecretImage(file())

    expect(image.mime).toBe('image/png')
    expect(Array.from(image.bytes)).toEqual(Array.from(PIXELS))
  })

  test('許されない型で戻ったら断る (SVG)', async () => {
    redrawn('image/svg+xml')

    await expect(prepareSecretImage(file())).rejects.toThrow(
      'この画像形式はシークレットにできません',
    )
  })

  test('型の無い Blob で戻っても断る', async () => {
    redrawn('')

    await expect(prepareSecretImage(file())).rejects.toThrow(
      'この画像形式はシークレットにできません',
    )
  })

  test('描き直しの失敗 (読めない形式) はそのまま伝える', async () => {
    mocks.redrawImage.mockRejectedValueOnce(
      new Error('この画像を読み取れませんでした。別の形式 (JPEG / PNG) でお試しください'),
    )

    await expect(prepareSecretImage(file())).rejects.toThrow(
      'この画像を読み取れませんでした。別の形式 (JPEG / PNG) でお試しください',
    )
  })
})
