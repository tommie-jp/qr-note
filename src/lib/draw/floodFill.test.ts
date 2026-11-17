import { describe, expect, test } from 'vitest'
import { floodFillMask, type RgbaImage, runStarts, spanAround } from './floodFill'

// 1 文字 1 画素の絵から RgbaImage を作る。'.' は白、'#' は黒、'r' は赤
const COLORS: Record<string, [number, number, number]> = {
  '.': [255, 255, 255],
  '#': [0, 0, 0],
  r: [255, 0, 0],
}

function imageFrom(rows: readonly string[]): RgbaImage {
  const height = rows.length
  const width = rows[0].length
  const data = new Uint8ClampedArray(width * height * 4)
  rows.forEach((row, y) => {
    ;[...row].forEach((char, x) => {
      const [r, g, b] = COLORS[char]
      const at = (y * width + x) * 4
      data[at] = r
      data[at + 1] = g
      data[at + 2] = b
      data[at + 3] = 255
    })
  })
  return { data, width, height }
}

// mask を目で見える形に戻す ('o' が塗る画素)
function render(mask: Uint8Array, width: number, height: number): string[] {
  const rows: string[] = []
  for (let y = 0; y < height; y += 1) {
    let row = ''
    for (let x = 0; x < width; x += 1) {
      row += mask[y * width + x] ? 'o' : '.'
    }
    rows.push(row)
  }
  return rows
}

describe('floodFillMask', () => {
  test('fills the whole canvas when it is one flat colour', () => {
    // Arrange
    const image = imageFrom(['...', '...'])

    // Act
    const result = floodFillMask(image, { x: 0, y: 0 }, { tolerance: 0, dilate: 0 })

    // Assert
    expect(render(result.mask, 3, 2)).toEqual(['ooo', 'ooo'])
    expect(result.bounds).toEqual({ left: 0, top: 0, width: 3, height: 2 })
  })

  test('stops at a drawn line', () => {
    // Arrange — 縦の線で左右に分かれた絵
    const image = imageFrom(['.#.', '.#.', '.#.'])

    // Act — 左側をクリック
    const result = floodFillMask(image, { x: 0, y: 1 }, { tolerance: 0, dilate: 0 })

    // Assert — 線を越えて右側へは漏れない
    expect(render(result.mask, 3, 3)).toEqual(['o..', 'o..', 'o..'])
  })

  test('does not leak through a diagonal gap (4 近傍)', () => {
    // Arrange — 斜めに置いた線は 4 近傍では塞がっている扱い
    const image = imageFrom(['.#', '#.'])

    // Act
    const result = floodFillMask(image, { x: 0, y: 0 }, { tolerance: 0, dilate: 0 })

    // Assert — 右下 (1,1) へは回り込めない
    expect(render(result.mask, 2, 2)).toEqual(['o.', '..'])
  })

  test('fills an area enclosed by a line', () => {
    // Arrange — 中が空いた四角
    const image = imageFrom(['#####', '#...#', '#...#', '#####'])

    // Act — 内側をクリック
    const result = floodFillMask(image, { x: 2, y: 2 }, { tolerance: 0, dilate: 0 })

    // Assert — 内側だけが塗られ、外へは出ない
    expect(render(result.mask, 5, 4)).toEqual([
      '.....',
      '.ooo.',
      '.ooo.',
      '.....',
    ])
    expect(result.bounds).toEqual({ left: 1, top: 1, width: 3, height: 2 })
  })

  test('treats near colours as the same when a tolerance is given', () => {
    // Arrange — 白の中に「ほぼ白」が 1 画素 (アンチエイリアスの縁のつもり)
    const image: RgbaImage = imageFrom(['..', '..'])
    image.data[4] = 250
    image.data[5] = 250
    image.data[6] = 250

    // Act — 許容差 0 では別の色、20 では同じ色として繋がる
    const strict = floodFillMask(image, { x: 0, y: 0 }, { tolerance: 0, dilate: 0 })
    const loose = floodFillMask(image, { x: 0, y: 0 }, { tolerance: 20, dilate: 0 })

    // Assert
    expect(strict.mask[1]).toBe(0)
    expect(loose.mask[1]).toBe(1)
  })

  test('grows the mask by the dilation so no halo is left along the line', () => {
    // Arrange
    const image = imageFrom(['.#.', '.#.', '.#.'])

    // Act — 1px 膨らませると線の下へ 1 画素食い込む
    const result = floodFillMask(image, { x: 0, y: 1 }, { tolerance: 0, dilate: 1 })

    // Assert
    expect(render(result.mask, 3, 3)).toEqual(['oo.', 'oo.', 'oo.'])
  })

  test('returns an empty result when the click is outside the image', () => {
    // Arrange
    const image = imageFrom(['..', '..'])

    // Act
    const result = floodFillMask(image, { x: 5, y: 5 }, { tolerance: 0, dilate: 0 })

    // Assert
    expect(result.bounds).toBeNull()
    expect(result.filled).toBe(0)
  })

  test('reports how many pixels were filled', () => {
    // Arrange
    const image = imageFrom(['#####', '#...#', '#####'])

    // Act
    const result = floodFillMask(image, { x: 2, y: 1 }, { tolerance: 0, dilate: 0 })

    // Assert
    expect(result.filled).toBe(3)
  })
})

describe('spanAround', () => {
  test('extends left and right while the predicate holds', () => {
    // Arrange — x = 2..5 が真
    const ok = (x: number) => x >= 2 && x <= 5

    // Act & Assert
    expect(spanAround(3, 10, ok)).toEqual({ left: 2, right: 5 })
  })

  test('stops at the row edges', () => {
    // Arrange & Act & Assert
    expect(spanAround(4, 8, () => true)).toEqual({ left: 0, right: 7 })
  })
})

describe('runStarts', () => {
  test('returns the first x of each connected run', () => {
    // Arrange — "##..#.##" の '#' が真
    const row = '##..#.##'
    const ok = (x: number) => row[x] === '#'

    // Act & Assert
    expect(runStarts(0, 7, ok)).toEqual([0, 4, 6])
  })

  test('returns nothing when no pixel matches', () => {
    // Arrange & Act & Assert
    expect(runStarts(0, 5, () => false)).toEqual([])
  })
})
