import * as fabric from 'fabric'
import { describe, expect, test } from 'vitest'
import { styleBrush } from './brushStyle'
import { toCanvasUnits } from './canvasUnits'
import { ERASER_SCALE, MARKER_SCALE, MIN_ERASER_WIDTH } from './drawCanvasConst'
import { MARKER_ALPHA } from './drawColor'

// 道具ごとの太さと色 (docs/34-お絵かき計画.md §3-2、docs/36 §2) を
// PencilBrush に当てて固定する。PencilBrush は canvas 無し (null) で作れる。
// EraserBrush (@erase2d/fabric) は生成時に document で裏 canvas を作るため
// node では作れない (docs/96 §0) — 消しゴムの分岐は width しか触らないので、
// PencilBrush を代役にして同じ分岐を通す

const pencil = () => new fabric.PencilBrush(null as unknown as fabric.Canvas)

const COLOR = '#ff3b30'

describe('styleBrush', () => {
  test('pen: width in canvas units at the fit scale, colour as chosen', () => {
    // Arrange — 100% 表示で半分に縮んでいる (論理 px は見た目の 2 倍)
    const brush = pencil()

    // Act
    styleBrush(brush, { tool: 'pen', color: COLOR, width: 6, fitScale: 0.5 })

    // Assert
    expect(brush.width).toBe(12)
    expect(brush.color).toBe(COLOR)
  })

  test('pen at 1:1 keeps the chosen width', () => {
    // Arrange
    const brush = pencil()

    // Act
    styleBrush(brush, { tool: 'pen', color: COLOR, width: 6, fitScale: 1 })

    // Assert
    expect(brush.width).toBe(6)
  })

  test('marker: wider than the pen and translucent', () => {
    // Arrange
    const brush = pencil()

    // Act
    styleBrush(brush, { tool: 'marker', color: COLOR, width: 6, fitScale: 0.5 })

    // Assert — 太さは MARKER_SCALE 倍、色は hex + 固定 alpha の rgba
    expect(brush.width).toBe(toCanvasUnits(6 * MARKER_SCALE, 0.5))
    expect(brush.width).toBe(36)
    expect(brush.color).toBe(`rgba(255, 59, 48, ${MARKER_ALPHA})`)
  })

  test('eraser: scaled up from the pen width and leaves the colour alone', () => {
    // Arrange — 消しゴムに色は無い (下を消すだけ)
    const brush = pencil()
    brush.color = 'untouched'

    // Act
    styleBrush(brush, { tool: 'eraser', color: COLOR, width: 6, fitScale: 0.5 })

    // Assert
    expect(brush.width).toBe(toCanvasUnits(6 * ERASER_SCALE, 0.5))
    expect(brush.width).toBe(36)
    expect(brush.color).toBe('untouched')
  })

  test('eraser never gets thinner than the minimum', () => {
    // Arrange — 細いペンでも狙って消せる太さを保つ
    const brush = pencil()

    // Act
    styleBrush(brush, { tool: 'eraser', color: COLOR, width: 1, fitScale: 1 })

    // Assert
    expect(brush.width).toBe(MIN_ERASER_WIDTH)
  })

  test('a zero fit scale (not measured yet) falls back to the floor instead of dividing by 0', () => {
    // Arrange
    const brush = pencil()

    // Act
    styleBrush(brush, { tool: 'pen', color: COLOR, width: 6, fitScale: 0 })

    // Assert
    expect(Number.isFinite(brush.width)).toBe(true)
    expect(brush.width).toBe(toCanvasUnits(6, 0))
  })

  test('any other tool is styled like the pen', () => {
    // Arrange — 呼び手はペン・マーカー・消しゴムでしかブラシを持たないが、
    // 関数の既定はペンの当て方
    const brush = pencil()

    // Act
    styleBrush(brush, { tool: 'fill', color: COLOR, width: 4, fitScale: 1 })

    // Assert
    expect(brush.width).toBe(4)
    expect(brush.color).toBe(COLOR)
  })
})
