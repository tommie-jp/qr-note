import { expect, test } from 'vitest'
import {
  MAX_CANVAS_PIXELS,
  MAX_DEVICE_PIXEL_RATIO,
  pageRenderScale,
} from './pdfScale'

// A4 縦 (pt)
const A4_W = 595
const A4_H = 842

test('幅フィットの倍率を返す (DPR 1)', () => {
  // 595pt を 595px で描くなら等倍
  expect(pageRenderScale(A4_W, A4_H, A4_W, 1)).toBeCloseTo(1)
  // 幅を倍にすれば倍率も倍
  expect(pageRenderScale(A4_W, A4_H, A4_W * 2, 1)).toBeCloseTo(2)
})

test('DPR を掛けて高精細に描く', () => {
  expect(pageRenderScale(A4_W, A4_H, A4_W, 2)).toBeCloseTo(2)
})

test('DPR は上限で頭打ちにする (iPhone の 3 倍を丸ごと掛けない)', () => {
  const at3 = pageRenderScale(A4_W, A4_H, A4_W, 3)
  expect(at3).toBeCloseTo(MAX_DEVICE_PIXEL_RATIO)
})

test('DPR が 1 未満でも 1 は確保する', () => {
  expect(pageRenderScale(A4_W, A4_H, A4_W, 0.5)).toBeCloseTo(1)
})

test('ピクセル数の上限を超えないよう倍率を落とす', () => {
  // 幅 4000px を DPR 2 で描くと 8000x11321 = 9000 万 px となり上限を大きく超える
  const scale = pageRenderScale(A4_W, A4_H, 4000, 2)
  const pixels = A4_W * scale * (A4_H * scale)

  expect(pixels).toBeLessThanOrEqual(MAX_CANVAS_PIXELS * 1.001)
  // 落としても 0 や負にはしない (表示はされる)
  expect(scale).toBeGreaterThan(0)
})

test('上限に当たらない大きさなら倍率をそのまま使う', () => {
  const scale = pageRenderScale(A4_W, A4_H, 800, 2)
  const pixels = A4_W * scale * (A4_H * scale)

  expect(pixels).toBeLessThanOrEqual(MAX_CANVAS_PIXELS)
  // 幅フィット x DPR が生きている
  expect(scale).toBeCloseTo((800 / A4_W) * 2)
})

// 呼び出し側は倍率を検算しないので、壊れた入力でも NaN / 0 除算を返さないこと
test('寸法が壊れていても 1 を返す (NaN や Infinity を返さない)', () => {
  expect(pageRenderScale(0, A4_H, 800, 2)).toBe(1)
  expect(pageRenderScale(A4_W, 0, 800, 2)).toBe(1)
  expect(pageRenderScale(A4_W, A4_H, 0, 2)).toBe(1)
  expect(pageRenderScale(Number.NaN, A4_H, 800, 2)).toBe(1)
  expect(pageRenderScale(-10, A4_H, 800, 2)).toBe(1)
})

test('横長のページでも面積で上限を守る', () => {
  const scale = pageRenderScale(A4_H, A4_W, 4000, 2)
  const pixels = A4_H * scale * (A4_W * scale)
  expect(pixels).toBeLessThanOrEqual(MAX_CANVAS_PIXELS * 1.001)
})
