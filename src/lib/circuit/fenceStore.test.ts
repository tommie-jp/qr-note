import { describe, expect, test, vi } from 'vitest'
import type { CircuitFence } from './fences'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ prisma: {} }))

const { circuitFencesOfMany } = await import('./fenceStore')
const { memoHash } = await import('./fenceMemo')

const F = '```'
const memoA = [`${F}circuit`, 'a', F].join('\n')
const memoB = [`${F}circuitikz`, 'b', F].join('\n')
const FENCE_A: CircuitFence = { lang: 'circuit', source: 'a' }
const FENCE_B: CircuitFence = { lang: 'circuitikz', source: 'b' }

function fakeDeps(stored: Record<string, unknown> = {}) {
  const parsed: string[] = []
  const saved: { memoHash: string; fences: readonly CircuitFence[] }[] = []
  const found: string[][] = []
  return {
    parsed,
    saved,
    found,
    deps: {
      find: async (hashes: readonly string[]) => {
        found.push([...hashes])
        return hashes.filter((h) => h in stored).map((h) => ({ memoHash: h, fences: stored[h] }))
      },
      save: async (rows: readonly { memoHash: string; fences: readonly CircuitFence[] }[]) => {
        saved.push(...rows)
      },
      parse: (memo: string) => {
        parsed.push(memo)
        return memo === memoA ? [FENCE_A] : memo === memoB ? [FENCE_B] : []
      },
    },
  }
}

describe('circuitFencesOfMany', () => {
  test('控えにある本文は解析せず、無い本文だけ解析して書き足す', async () => {
    // Arrange
    const { deps, parsed, saved } = fakeDeps({ [memoHash(memoA)]: [FENCE_A] })

    // Act
    const result = await circuitFencesOfMany([memoA, memoB], deps)

    // Assert
    expect(result).toEqual([[FENCE_A], [FENCE_B]])
    expect(parsed).toEqual([memoB])
    expect(saved).toEqual([{ memoHash: memoHash(memoB), fences: [FENCE_B] }])
  })

  test('回路の言語名を含まない本文は引きにも行かない', async () => {
    const { deps, parsed, found } = fakeDeps()

    const result = await circuitFencesOfMany(['ただの本文', '# 見出し'], deps)

    expect(result).toEqual([[], []])
    expect(found).toEqual([])
    expect(parsed).toEqual([])
  })

  test('同じ本文が並んでも解析と書き足しは 1 回', async () => {
    const { deps, parsed, saved } = fakeDeps()

    const result = await circuitFencesOfMany([memoA, memoA], deps)

    expect(result).toEqual([[FENCE_A], [FENCE_A]])
    expect(parsed).toHaveLength(1)
    expect(saved).toHaveLength(1)
  })

  test('形の違う控えは使わずに解析し直す', async () => {
    const { deps, parsed } = fakeDeps({ [memoHash(memoA)]: [{ lang: 'mermaid', source: 'x' }] })

    const result = await circuitFencesOfMany([memoA], deps)

    expect(result).toEqual([[FENCE_A]])
    expect(parsed).toEqual([memoA])
  })

  test('控えが引けない・書けないときも解析で返す', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { deps } = fakeDeps()

    const result = await circuitFencesOfMany([memoA], {
      ...deps,
      find: async () => {
        throw new Error('db down')
      },
      save: async () => {
        throw new Error('db down')
      },
    })

    expect(result).toEqual([[FENCE_A]])
    expect(console.warn).toHaveBeenCalledTimes(2)
  })
})
