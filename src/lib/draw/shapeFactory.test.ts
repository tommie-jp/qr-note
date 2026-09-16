import * as fabric from 'fabric'
import { describe, expect, test } from 'vitest'
import { createShape, REGION_PREVIEW_FILL, SHAPE_DEFAULTS } from './shapeFactory'

// ドラッグで置く図形 (docs/36-お絵かき拡張計画.md §1) を道具ごとに固定する。
// fabric の Rect・Ellipse・Path は DOM 無しで作れる (docs/96 §0) ので、
// toObject() の座標・線・鏃の形をそのまま見る。IText と canvas は作れない
// ので、文字道具と実際の描画は E2E に任せる

const FROM = { x: 10, y: 20 }
const TO = { x: 110, y: 80 }
const COLOR = '#ff0000'
const STROKE = 4

// toObject() に erasable を含める (直列化と同じ指定。docs/34 §6)
const objectOf = (shape: fabric.FabricObject | null) => {
  if (!shape) {
    throw new Error('図形が作られていません')
  }
  return shape.toObject(['erasable'])
}

describe('createShape', () => {
  test('arrow is a single Path: shaft, then the two barbs folded back at the tip', () => {
    // Arrange — 水平に 100px。鏃の長さは太さ × 4 = 16 (軸の 4 割 = 40 より短い)
    const from = { x: 10, y: 10 }
    const to = { x: 110, y: 10 }

    // Act
    const shape = createShape('arrow', from, to, COLOR, STROKE)
    const object = objectOf(shape)

    // Assert — 先端から 16 戻り、軸から ±π/7 に開いた 2 点 (小数 2 桁)
    expect(shape).toBeInstanceOf(fabric.Path)
    expect(object.type).toBe('Path')
    expect(object.path).toEqual([
      ['M', 10, 10],
      ['L', 110, 10],
      ['M', 95.58, 16.94],
      ['L', 110, 10],
      ['L', 95.58, 3.06],
    ])
    expect(object.stroke).toBe(COLOR)
    expect(object.strokeWidth).toBe(STROKE)
    expect(object.fill).toBeNull()
    expect(object.strokeLineCap).toBe('round')
    expect(object.strokeLineJoin).toBe('round')
    expect(object.erasable).toBe(true)
  })

  test('arrow is created even without movement (the caller discards taps)', () => {
    // Arrange & Act & Assert — タップの判定は attachShapeTool 側 (minDrag)
    expect(createShape('arrow', FROM, FROM, COLOR, STROKE)).toBeInstanceOf(fabric.Path)
  })

  test('rect keeps the stroke centred on the dragged rectangle', () => {
    // Arrange & Act
    const object = objectOf(createShape('rect', FROM, TO, COLOR, STROKE))

    // Assert — fabric の left/top は「ストロークを含む箱」の角なので半太さ戻す
    expect(object.type).toBe('Rect')
    expect(object).toMatchObject({
      left: 8,
      top: 18,
      width: 100,
      height: 60,
      originX: 'left',
      originY: 'top',
      fill: null,
      stroke: COLOR,
      strokeWidth: STROKE,
      strokeLineCap: 'round',
      strokeLineJoin: 'round',
      erasable: true,
    })
  })

  test('rect normalises a drag towards the top-left', () => {
    // Arrange & Act — 終点から始点へ逆向きにドラッグ
    const object = objectOf(createShape('rect', TO, FROM, COLOR, STROKE))

    // Assert — 幅と高さは正のまま、同じ場所
    expect(object).toMatchObject({ left: 8, top: 18, width: 100, height: 60 })
  })

  test('ellipse is inscribed in the dragged rectangle', () => {
    // Arrange & Act
    const shape = createShape('ellipse', FROM, TO, COLOR, STROKE)
    const object = objectOf(shape)

    // Assert — 左上は半太さ戻し、半径はドラッグ矩形の半分
    expect(shape).toBeInstanceOf(fabric.Ellipse)
    expect(object).toMatchObject({
      left: 8,
      top: 18,
      rx: 50,
      ry: 30,
      originX: 'left',
      originY: 'top',
      fill: null,
      stroke: COLOR,
      strokeWidth: STROKE,
    })
  })

  test('mosaic is a translucent preview without a stroke, exactly on the region', () => {
    // Arrange & Act
    const shape = createShape('mosaic', FROM, TO, COLOR, STROKE)
    const object = objectOf(shape)

    // Assert — 処理範囲 (onRegion の rect) と見た目を一致させるため、
    // 半太さ戻しもストロークも無い (fabric は stroke が無くても
    // strokeWidth を寸法に数える)
    expect(shape).toBeInstanceOf(fabric.Rect)
    expect(object).toMatchObject({
      left: 10,
      top: 20,
      width: 100,
      height: 60,
      fill: REGION_PREVIEW_FILL,
      strokeWidth: 0,
    })
    expect(object.stroke).toBeUndefined()
  })

  test('rect, ellipse and mosaic return null without movement', () => {
    // Arrange & Act & Assert — 幅も高さも 0 の図形は置かない
    expect(createShape('rect', FROM, FROM, COLOR, STROKE)).toBeNull()
    expect(createShape('ellipse', FROM, FROM, COLOR, STROKE)).toBeNull()
    expect(createShape('mosaic', FROM, FROM, COLOR, STROKE)).toBeNull()
  })

  test('returns null for tools that do not place shapes', () => {
    // Arrange & Act & Assert
    expect(createShape('pen', FROM, TO, COLOR, STROKE)).toBeNull()
    expect(createShape('text', FROM, TO, COLOR, STROKE)).toBeNull()
    expect(createShape('select', FROM, TO, COLOR, STROKE)).toBeNull()
  })

  test('shapes are neither selectable nor evented right after placing', () => {
    // Arrange & Act — 置いた直後に掴めると次のドラッグの邪魔になる
    const shapes = (['arrow', 'rect', 'ellipse', 'mosaic'] as const).map((tool) =>
      createShape(tool, FROM, TO, COLOR, STROKE),
    )

    // Assert — 選択は「選択」道具に切り替えたときだけ有効になる (useDrawLayers)
    for (const shape of shapes) {
      expect(shape?.selectable).toBe(false)
      expect(shape?.evented).toBe(false)
    }
  })
})

describe('SHAPE_DEFAULTS', () => {
  test('pins the v7 origin to top-left and the frame to stroke only', () => {
    // Arrange & Act & Assert — origin を明示しないと left/top が中心と解釈され、
    // 図形が幅・高さの半分だけ左上へずれる (docs/36 §4-4)
    expect(SHAPE_DEFAULTS).toEqual({
      originX: 'left',
      originY: 'top',
      fill: null,
      selectable: false,
      evented: false,
      erasable: true,
      strokeLineCap: 'round',
      strokeLineJoin: 'round',
    })
  })

  test('region preview is a translucent black', () => {
    // Arrange & Act & Assert
    expect(REGION_PREVIEW_FILL).toBe('rgba(0, 0, 0, 0.4)')
  })
})
