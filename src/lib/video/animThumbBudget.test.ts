import { expect, test } from 'vitest'
import {
  AUTO_VISIBLE_RATIO,
  isVisibleEnough,
  MAX_AUTO_ANIM,
  releaseAutoAnimSlot,
  takeAutoAnimSlot,
} from './animThumbBudget'

test('少しだけ覗いているサムネは自動再生しない', () => {
  // IntersectionObserver の threshold を渡すだけでは足切りにならない —
  // 交差の報告は isIntersecting (少しでも重なれば true) でも飛んでくる。
  // 素通しすると、下端に少し覗いた行が次々と枠を取って上限を使い切る
  expect(isVisibleEnough(0)).toBe(false)
  expect(isVisibleEnough(0.05)).toBe(false)
  expect(isVisibleEnough(0.4)).toBe(false)
})

test('しっかり入っているサムネは自動再生してよい', () => {
  expect(isVisibleEnough(AUTO_VISIBLE_RATIO)).toBe(true)
  expect(isVisibleEnough(0.9)).toBe(true)
  expect(isVisibleEnough(1)).toBe(true)
})

test('閾値ちょうどを僅かに下回る報告値も通す', () => {
  // 閾値をまたいだ瞬間の報告値は 0.5999… になることがある。そこで弾くと、
  // 以後スクロールしても新たな閾値越えが起きず永久に動かないサムネができる
  expect(isVisibleEnough(AUTO_VISIBLE_RATIO - 0.000001)).toBe(true)
})

test('上限までは枠を取れる', () => {
  const played = new Set<string>()

  for (let i = 0; i < MAX_AUTO_ANIM; i++) {
    expect(takeAutoAnimSlot(played, `v${i}`)).toBe(true)
  }
  expect(played.size).toBe(MAX_AUTO_ANIM)
})

test('上限を超えたら取れない', () => {
  // 一覧は延々とスクロールできるので、上限が無いと最後まで見た人が
  // 全件ぶんの動くサムネを引くことになる
  const played = new Set<string>()
  for (let i = 0; i < MAX_AUTO_ANIM; i++) {
    takeAutoAnimSlot(played, `v${i}`)
  }

  expect(takeAutoAnimSlot(played, 'あふれた分')).toBe(false)
  expect(played.size).toBe(MAX_AUTO_ANIM)
})

test('同じサムネは何度でも取れる (上限は 1 本と数える)', () => {
  // 画面を出入りするたびに数えると、行き来しただけで枠が尽きる。
  // 二度目以降はブラウザのキャッシュから出るので転送も増えない
  const played = new Set<string>()
  for (let i = 0; i < MAX_AUTO_ANIM; i++) {
    takeAutoAnimSlot(played, `v${i}`)
  }

  expect(takeAutoAnimSlot(played, 'v0')).toBe(true)
  expect(takeAutoAnimSlot(played, 'v0')).toBe(true)
  expect(played.size).toBe(MAX_AUTO_ANIM)
})

test('枠を返すと空きが戻る', () => {
  // 未生成 (404) だった動画は一度も再生できていないので、枠を返す。
  // 返さないと、生成されていない動画が並ぶ一覧で 404 だけで枠を使い切る
  const played = new Set<string>()
  for (let i = 0; i < MAX_AUTO_ANIM; i++) {
    takeAutoAnimSlot(played, `v${i}`)
  }
  expect(takeAutoAnimSlot(played, '新顔')).toBe(false)

  releaseAutoAnimSlot(played, 'v0')

  expect(takeAutoAnimSlot(played, '新顔')).toBe(true)
})

test('枠を取っていないものを返しても壊れない', () => {
  const played = new Set<string>()

  releaseAutoAnimSlot(played, '知らない子')

  expect(played.size).toBe(0)
})
