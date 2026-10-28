import { describe, expect, test, vi } from 'vitest'
import { extractCircuitFences, type CircuitFence } from './fences'
import { circuitFencesOf, createFenceMemo } from './fenceMemo'

const TIKZ = (body: string) => `前置き\n\n\`\`\`circuitikz\n${body}\n\`\`\`\n`

describe('createFenceMemo', () => {
  test('同じ本文の 2 回目は解析しない', () => {
    // Arrange
    const parse = vi.fn(extractCircuitFences)
    const fencesOf = createFenceMemo(parse)

    // Act
    const first = fencesOf(TIKZ('A'))
    const second = fencesOf(TIKZ('A'))

    // Assert
    expect(parse).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
  })

  test('本文が 1 文字でも違えば解析し直す', () => {
    const parse = vi.fn(extractCircuitFences)
    const fencesOf = createFenceMemo(parse)

    fencesOf(TIKZ('A'))
    const changed = fencesOf(TIKZ('B'))

    expect(parse).toHaveBeenCalledTimes(2)
    expect(changed.map((f) => f.source)).toEqual(['B'])
  })

  test('上限を超えたら最も長く使われていないものから捨てる', () => {
    const parse = vi.fn((_memo: string): CircuitFence[] => [])
    const fencesOf = createFenceMemo(parse, 2)

    fencesOf('a')
    fencesOf('b')
    fencesOf('a') // a を使い直したので、次に捨てられるのは b
    fencesOf('c')
    parse.mockClear()
    fencesOf('a')
    fencesOf('b')

    expect(parse.mock.calls.map(([memo]) => memo)).toEqual(['b'])
  })

  test('覚えた結果は呼び出し側から書き換えられない', () => {
    const fencesOf = createFenceMemo(extractCircuitFences)

    const fences = fencesOf(TIKZ('A'))

    expect(Object.isFrozen(fences)).toBe(true)
  })
})

describe('circuitFencesOf', () => {
  test('extractCircuitFences と同じ結果を返す', () => {
    const md = [
      '```circuitikz\nA\n```',
      '```circuit\nparts: []\n```',
      '```circuitikz\nA\n```',
      '```bash\nls\n```',
    ].join('\n\n')

    expect(circuitFencesOf(md)).toEqual(extractCircuitFences(md))
  })
})

test('記憶はプロセスで 1 つ (別々に束ねられた読み込み先でも同じ関数)', async () => {
  // モジュールを読み直す = Next が別々に束ねた読み込み先と同じ状況
  vi.resetModules()
  const again = await import('./fenceMemo')

  expect(again.circuitFencesOf).toBe(circuitFencesOf)
})
