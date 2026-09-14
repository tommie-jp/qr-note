import { describe, expect, test } from 'vitest'
import {
  encodeDrawing,
  fitDisplayScale,
  toBlob,
  toCanvasUnits,
} from './canvasUnits'
import {
  MAX_DISPLAY_SCALE,
  MIN_DISPLAY_SCALE,
  WEBP_QUALITY,
} from './drawCanvasConst'

// toBlob だけを持つ canvas の身代わり。求められた形式ごとに返す Blob を決め、
// 呼ばれた形式と品質を控える
function fakeCanvas(answer: (type: string) => Blob | null) {
  const calls: Array<{ type: string; quality: unknown }> = []
  const canvas = {
    toBlob: (callback: BlobCallback, type?: string, quality?: unknown) => {
      calls.push({ type: type ?? '', quality })
      callback(answer(type ?? ''))
    },
  }
  return { canvas, calls }
}

describe('toCanvasUnits', () => {
  test('scales screen pixels up by the display scale', () => {
    // Arrange & Act & Assert — 1600px を 400px で見ているなら 6px は 24 論理 px
    expect(toCanvasUnits(6, 0.25)).toBe(24)
  })

  test('keeps screen pixels as is at 100%', () => {
    // Arrange & Act & Assert
    expect(toCanvasUnits(6, 1)).toBe(6)
  })

  test('does not divide by zero before the stage is measured', () => {
    // Arrange & Act & Assert
    expect(toCanvasUnits(6, 0)).toBe(6 / MIN_DISPLAY_SCALE)
  })
})

describe('fitDisplayScale', () => {
  test('fits the side that runs out first', () => {
    // Arrange
    const size = { width: 1600, height: 900 }

    // Act
    const scale = fitDisplayScale(size, 800, 900)

    // Assert — 幅は 0.5、高さは 1。全体が見える方 (小さい方) に合わせる
    expect(scale).toBe(0.5)
  })

  test('does not blow a small image up past the limit', () => {
    // Arrange
    const size = { width: 100, height: 100 }

    // Act
    const scale = fitDisplayScale(size, 1000, 1000)

    // Assert
    expect(scale).toBe(MAX_DISPLAY_SCALE)
  })

  test('stays at 1 while the canvas is not ready', () => {
    // Arrange & Act & Assert
    expect(fitDisplayScale(null, 800, 600)).toBe(1)
  })

  test('stays at 1 before the stage is measured', () => {
    // Arrange
    const size = { width: 1600, height: 900 }

    // Act & Assert
    expect(fitDisplayScale(size, 0, 600)).toBe(1)
    expect(fitDisplayScale(size, 800, 0)).toBe(1)
  })
})

describe('toBlob', () => {
  test('resolves with the blob the canvas made', async () => {
    // Arrange
    const made = new Blob(['x'], { type: 'image/png' })
    const { canvas, calls } = fakeCanvas(() => made)

    // Act
    const blob = await toBlob(canvas, 'image/png', 0.5)

    // Assert
    expect(blob).toBe(made)
    expect(calls).toEqual([{ type: 'image/png', quality: 0.5 }])
  })

  test('resolves with null when the canvas could not encode', async () => {
    // Arrange
    const { canvas } = fakeCanvas(() => null)

    // Act & Assert
    await expect(toBlob(canvas, 'image/png')).resolves.toBeNull()
  })
})

describe('encodeDrawing', () => {
  test('prefers WebP at the fixed quality', async () => {
    // Arrange
    const { canvas, calls } = fakeCanvas((type) => new Blob(['x'], { type }))

    // Act
    const encoded = await encodeDrawing(canvas)

    // Assert
    expect(encoded.extension).toBe('webp')
    expect(encoded.blob.type).toBe('image/webp')
    expect(calls).toEqual([{ type: 'image/webp', quality: WEBP_QUALITY }])
  })

  test('falls back to PNG when the browser quietly returns PNG for WebP', async () => {
    // Arrange — toBlob は非対応の形式を黙って PNG にすることがある
    const { canvas, calls } = fakeCanvas(() => new Blob(['x'], { type: 'image/png' }))

    // Act
    const encoded = await encodeDrawing(canvas)

    // Assert
    expect(encoded.extension).toBe('png')
    expect(calls.map((call) => call.type)).toEqual(['image/webp', 'image/png'])
  })

  test('falls back to PNG when WebP could not be made at all', async () => {
    // Arrange
    const { canvas } = fakeCanvas((type) =>
      type === 'image/webp' ? null : new Blob(['x'], { type }),
    )

    // Act
    const encoded = await encodeDrawing(canvas)

    // Assert
    expect(encoded.extension).toBe('png')
    expect(encoded.blob.type).toBe('image/png')
  })

  test('throws when neither format could be made', async () => {
    // Arrange
    const { canvas } = fakeCanvas(() => null)

    // Act & Assert
    await expect(encodeDrawing(canvas)).rejects.toThrow('お絵かきを画像にできませんでした。')
  })
})
