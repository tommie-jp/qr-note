import { expect, test } from 'vitest'
import { CIRCUIT_TIMEOUT_MS, CircuitRenderError, renderCircuit } from './circuitikz'

// 暴走した TeX を上限時間で打ち切れることの回帰テスト。**1 本きりで、丸ごと
// CIRCUIT_TIMEOUT_MS だけ待つ**ので、他と同居させるとその待ち時間がまるまる
// テストファイルの所要に積み上がる。vitest はファイル単位で並列化するため、
// 独立させておけば他のテストの裏に隠れる (理由の詳しくは
// circuitikz.render.test.ts のヘッダ / docs/80-デプロイ再高速化計画.md §9)。
//
// 待ち時間そのものは縮められない — 「上限時間まで待ってから確実に返る」ことが
// 検査したい性質そのものなので、短くすると何も確かめていないことになる。

test(
  'kills a runaway TeX loop instead of hanging forever',
  async () => {
    // tex2svg には timeout が無く、これは放置すると永遠に返らない
    const loop = String.raw`\def\x{\x}\x`

    const started = Date.now()
    const error = await renderCircuit(loop).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(CircuitRenderError)
    expect((error as CircuitRenderError).message).toMatch(/中断/)
    // 本質はここ: 放置すれば無限に返らないものが、上限時間で確実に返ること
    expect(Date.now() - started).toBeGreaterThanOrEqual(CIRCUIT_TIMEOUT_MS)
    expect(Date.now() - started).toBeLessThan(CIRCUIT_TIMEOUT_MS + 5_000)
  },
  CIRCUIT_TIMEOUT_MS + 20_000,
)
