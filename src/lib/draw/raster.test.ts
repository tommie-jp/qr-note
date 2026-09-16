import { describe, expect, test } from 'vitest'
import type { DragRect } from './shapes'
import { clampToCanvas, cropImage } from './raster'

// 幅 w・高さ h の画素を作る。fill(x, y) が [r, g, b, a] を返す (pixelate.test.ts と同じ)
function imageOf(
  width: number,
  height: number,
  fill: (x: number, y: number) => [number, number, number, number],
) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = fill(x, y)
      const at = (y * width + x) * 4
      data[at] = r
      data[at + 1] = g
      data[at + 2] = b
      data[at + 3] = a
    }
  }
  return { data, width, height }
}

// (x, y) の RGBA を読む
function pixelAt(
  image: { data: Uint8ClampedArray; width: number },
  x: number,
  y: number,
): number[] {
  const at = (y * image.width + x) * 4
  return [...image.data.slice(at, at + 4)]
}

const blank = (width: number, height: number) => imageOf(width, height, () => [0, 0, 0, 0])

describe('clampToCanvas', () => {
  test('rounds a fractional drag outward to whole pixels', () => {
    // Arrange — 端数の矩形。左上は切り捨て、右下は切り上げて画素を取りこぼさない
    const rect: DragRect = { left: 2.3, top: 1.7, width: 3.2, height: 2.1 }

    // Act
    const bounds = clampToCanvas(rect, blank(10, 10))

    // Assert — 右端 5.5 → 6、下端 3.8 → 4
    expect(bounds).toEqual({ left: 2, top: 1, width: 4, height: 3 })
  })

  test('clips the rectangle to the canvas', () => {
    // Arrange — canvas より大きく囲った
    const rect: DragRect = { left: -5, top: -5, width: 100, height: 100 }

    // Act
    const bounds = clampToCanvas(rect, blank(10, 8))

    // Assert — はみ出したまま切り出すと getImageData の範囲外になる
    expect(bounds).toEqual({ left: 0, top: 0, width: 10, height: 8 })
  })

  test('returns null when the rectangle lies outside the canvas', () => {
    // Arrange & Act & Assert
    expect(clampToCanvas({ left: 20, top: 0, width: 5, height: 5 }, blank(10, 10))).toBeNull()
    expect(clampToCanvas({ left: 0, top: -9, width: 5, height: 5 }, blank(10, 10))).toBeNull()
  })

  test('returns null for a zero-sized rectangle', () => {
    // Arrange & Act & Assert — タップでは何も加工しない
    expect(clampToCanvas({ left: 3, top: 3, width: 0, height: 0 }, blank(10, 10))).toBeNull()
  })

  test('keeps at least one pixel for a tiny fractional rectangle', () => {
    // Arrange & Act
    const bounds = clampToCanvas({ left: 3.2, top: 3.2, width: 0.1, height: 0.1 }, blank(10, 10))

    // Assert — 3.2〜3.3 は画素 3 に掛かる
    expect(bounds).toEqual({ left: 3, top: 3, width: 1, height: 1 })
  })

  test('does not modify the given rectangle', () => {
    // Arrange
    const rect: DragRect = { left: 2.3, top: 1.7, width: 3.2, height: 2.1 }

    // Act
    clampToCanvas(rect, blank(10, 10))

    // Assert
    expect(rect).toEqual({ left: 2.3, top: 1.7, width: 3.2, height: 2.1 })
  })
})

describe('cropImage', () => {
  test('copies the pixels inside the bounds row by row', () => {
    // Arrange — 座標がそのまま色になる 4x3
    const image = imageOf(4, 3, (x, y) => [x, y, 0, 255])

    // Act
    const region = cropImage(image, { left: 1, top: 1, width: 2, height: 2 })

    // Assert
    expect(region.width).toBe(2)
    expect(region.height).toBe(2)
    expect(region.data.length).toBe(2 * 2 * 4)
    expect(pixelAt(region, 0, 0)).toEqual([1, 1, 0, 255])
    expect(pixelAt(region, 1, 0)).toEqual([2, 1, 0, 255])
    expect(pixelAt(region, 0, 1)).toEqual([1, 2, 0, 255])
    expect(pixelAt(region, 1, 1)).toEqual([2, 2, 0, 255])
  })

  test('returns the whole image unchanged for full bounds', () => {
    // Arrange
    const image = imageOf(3, 2, (x, y) => [x * 10, y * 10, 7, 255])

    // Act
    const region = cropImage(image, { left: 0, top: 0, width: 3, height: 2 })

    // Assert
    expect([...region.data]).toEqual([...image.data])
  })

  test('returns a copy that does not share memory with the source', () => {
    // Arrange
    const image = imageOf(2, 2, () => [9, 9, 9, 255])

    // Act
    const region = cropImage(image, { left: 0, top: 0, width: 1, height: 1 })
    region.data[0] = 0

    // Assert — 加工は切り出した側にだけ効く
    expect(pixelAt(image, 0, 0)).toEqual([9, 9, 9, 255])
  })
})
