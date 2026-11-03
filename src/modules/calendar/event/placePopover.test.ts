import { describe, expect, test } from 'vitest'
import { placeAround, placePopover } from './placePopover'

const cell = (left: number, top: number, w = 150, h = 110) => ({ left, top, right: left + w, bottom: top + h })
const size = { width: 260, height: 300 }
const wide = { width: 1100, height: 900 }

describe('placePopover', () => {
  test('右に入れば右に、上端をマスに揃える', () => {
    expect(placePopover(cell(310, 145), size, wide)).toEqual({ left: 464, top: 145, maxHeight: 884, side: 'right' })
  })

  test('右がはみ出すなら左に出す', () => {
    const p = placePopover(cell(920, 145), size, wide)
    expect(p.side).toBe('left')
    expect(p.left).toBe(920 - 4 - 260)
  })

  test('下がはみ出すなら上へずらして全部見せる', () => {
    expect(placePopover(cell(310, 800), size, wide).top).toBe(900 - 8 - 300)
  })

  test('画面より背が高ければ画面の高さに縮める', () => {
    const p = placePopover(cell(310, 400), { width: 260, height: 2000 }, wide)
    expect(p.top).toBe(8)
    expect(p.maxHeight).toBe(884)
  })

  test('左右どちらにも入らない狭い画面では画面の中へ寄せる', () => {
    const p = placePopover(cell(167, 200, 55, 64), size, { width: 390, height: 844 })
    expect(p.side).toBe('over')
    expect(p.left).toBeGreaterThanOrEqual(8)
    expect(p.left + 260).toBeLessThanOrEqual(390 - 8)
  })
})

describe('placeAround', () => {
  const row = (top: number) => ({ left: 0, top, right: 1100, bottom: top + 24 })
  const form = { width: 320, height: 300 }

  test('下に入れば行の下に出し、左は画面の端から離す', () => {
    expect(placeAround(row(100), form, wide)).toEqual({ left: 8, top: 128, maxHeight: 764, side: 'over' })
  })

  test('下に入らなければ行の上に出す (下のペインの行)', () => {
    const p = placeAround(row(700), form, wide)
    expect(p.top).toBe(700 - 4 - 300)
    expect(p.top + form.height).toBe(696)
  })

  test('上下どちらにも入らなければ広いほうへ寄せて縮める', () => {
    const p = placeAround(row(250), { width: 320, height: 800 }, { width: 400, height: 600 })
    expect(p).toEqual({ left: 8, top: 278, maxHeight: 314, side: 'over' })
    const q = placeAround(row(400), { width: 320, height: 800 }, { width: 400, height: 600 })
    expect(q).toEqual({ left: 8, top: 8, maxHeight: 388, side: 'over' })
  })

  test('右にはみ出すなら行の左端から左へ寄せる', () => {
    const p = placeAround({ left: 300, top: 100, right: 390, bottom: 124 }, form, { width: 400, height: 900 })
    expect(p.left).toBe(400 - 8 - 320)
  })
})
