import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { PendingCircuit } from '@/lib/circuit/types'

// ノートの描画材料 (docs/123 §1-3)。Map を組の配列で運ぶことと、
// 添付量だけの問い合わせで集計を撃たないことを固定する
const mocks = vi.hoisted(() => ({
  planCircuits: vi.fn(),
  buildMatrices: vi.fn(),
  buildHealthCharts: vi.fn(),
  pinAttachmentBytes: vi.fn(),
}))

vi.mock('@/lib/circuit/cache', () => ({ planCircuits: mocks.planCircuits }))
vi.mock('@/lib/matrix/matrixData', () => ({ buildMatrices: mocks.buildMatrices }))
vi.mock('@/lib/health/healthData', () => ({ buildHealthCharts: mocks.buildHealthCharts }))
vi.mock('@/lib/offline/pinSize', () => ({ pinAttachmentBytes: mocks.pinAttachmentBytes }))

const { loadNoteCircuits, loadNoteRender } = await import('./notePayload')

beforeEach(() => {
  vi.resetAllMocks()
  mocks.buildMatrices.mockResolvedValue(new Map([['m', { kind: 'error', error: 'e' }]]))
  mocks.buildHealthCharts.mockResolvedValue(new Map())
  mocks.pinAttachmentBytes.mockResolvedValue(99)
})

describe('loadNoteRender', () => {
  test('表・健康の Map を組の配列にして添付量と返す', async () => {
    // Act
    const render = await loadNoteRender('memo')

    // Assert
    expect(render).toEqual({
      matrices: [['m', { kind: 'error', error: 'e' }]],
      health: [],
      attachmentBytes: 99,
    })
  })

  test('添付量だけなら表と健康を集計しない', async () => {
    // Act
    const render = await loadNoteRender('memo', { bytesOnly: true })

    // Assert
    expect(render).toEqual({ matrices: [], health: [], attachmentBytes: 99 })
    expect(mocks.buildMatrices).not.toHaveBeenCalled()
    expect(mocks.buildHealthCharts).not.toHaveBeenCalled()
  })
})

describe('loadNoteCircuits', () => {
  test('描き終えた図も待っている図も、解けた結果の組にして返す', async () => {
    // Arrange
    mocks.planCircuits.mockReturnValue(
      new Map<string, PendingCircuit>([
        ['a', { svg: '<svg/>' }],
        ['b', Promise.resolve({ error: 'TeX', texLog: 'log' })],
      ]),
    )

    // Act
    const { circuits } = await loadNoteCircuits('memo')

    // Assert
    expect(circuits).toEqual([
      ['a', { svg: '<svg/>' }],
      ['b', { error: 'TeX', texLog: 'log' }],
    ])
  })
})
