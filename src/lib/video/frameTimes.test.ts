import { expect, test } from 'vitest'
import {
  FIRST_FRAME_SEC,
  frameTimes,
  MIN_ANIM_DURATION_SEC,
} from './frameTimes'

test('動画全体を等間隔に割った時刻を返す', () => {
  // 冒頭だけでなく全体から抜く。手元の記録は「最初の 3 秒」より
  // 「どこで何をしているか」のほうが一覧で役に立つ
  const times = frameTimes(10, 5)

  expect(times).toHaveLength(5)
  expect(times[0]).toBe(FIRST_FRAME_SEC)
  expect(times[4]).toBeCloseTo(9.8, 5) // 末尾は 98% 地点
  // 間隔が一定
  const gaps = times.slice(1).map((t, i) => t - times[i])
  for (const gap of gaps) {
    expect(gap).toBeCloseTo(gaps[0], 5)
  }
})

test('先頭は真っ黒コマを避けた位置から始める', () => {
  // 0 秒ちょうどはフェードイン・黒コマのことがある (videoPoster の poster と
  // 同じ位置にすることで、シークを 1 回節約する意味もある)
  expect(frameTimes(30, 8)[0]).toBe(FIRST_FRAME_SEC)
})

test('末尾は終端そのものにしない', () => {
  // 最終フレームはデコードできないことがあり、シークが返ってこない端末もある
  const times = frameTimes(20, 4)

  expect(times[times.length - 1]).toBeLessThan(20)
})

test('短すぎる動画では作らない (空を返す)', () => {
  // 1 秒未満はほぼ同じ絵が並ぶだけで、静止サムネとの違いが出ない
  expect(frameTimes(MIN_ANIM_DURATION_SEC - 0.01, 8)).toEqual([])
  expect(frameTimes(0.2, 8)).toEqual([])
  expect(frameTimes(0, 8)).toEqual([])
})

test('尺が判らない動画では作らない', () => {
  // MediaRecorder の webm は duration が Infinity のまま来ることがある
  // (fix-webm-duration を通す前など)。シーク先を決められないので諦める
  expect(frameTimes(Infinity, 8)).toEqual([])
  expect(frameTimes(NaN, 8)).toEqual([])
})

test('コマ数が 2 未満なら作らない', () => {
  expect(frameTimes(10, 1)).toEqual([])
  expect(frameTimes(10, 0)).toEqual([])
})

test('負の尺は作らない', () => {
  expect(frameTimes(-5, 8)).toEqual([])
})
