import { beforeEach, describe, expect, test, vi } from 'vitest'
import { circuitHash } from './hash'

// DB は差し替えて、足切り・突き合わせの分岐だけを見る。返すのは SVG の hash
// (docs/124 §1)。描画 (renderCircuit) はこのモジュールから決して呼ばれない —
// 一覧は「引くだけ」の約束 (docs/68-一覧回路図サムネ計画.md §2)
const queryRaw = vi.fn()

vi.mock('../db', () => ({
  prisma: {
    // タグ付きテンプレートで呼ばれる。値の 1 つ目が引く hash の並び
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => queryRaw(values),
    // 回路フェンスの控え (docs/122 §1) は空のまま。毎回解析に落ちる
    memoCircuitFences: { findMany: async () => [], createMany: async () => ({ count: 0 }) },
  },
}))

const { MAX_CIRCUIT_THUMB_BYTES, loadCircuitThumbs } = await import('./thumbs')

const A = circuitHash('A')
const B = circuitHash('B')
const IMAGE = '0421547b-ee29-4613-a6d4-da0f41f94054.jpg'

const fence = (source: string) => `\`\`\`circuitikz\n${source}\n\`\`\``
const makeItem = (itemId: string, memo: string) => ({ itemId, memo })
const stored = (...hashes: string[]) => hashes.map((hash) => ({ hash, bytes: 3000 }))

beforeEach(() => {
  vi.clearAllMocks()
  queryRaw.mockResolvedValue([])
})

describe('足切り (DB を引くまでもない物)', () => {
  test('回路図フェンスの無いノートだけならクエリ 0 回で空を返す', async () => {
    // Act
    const map = await loadCircuitThumbs([makeItem('1', '文章だけのノート')], 'first')

    // Assert
    expect(map).toEqual({})
    expect(queryRaw).not.toHaveBeenCalled()
  })

  test('first では画像サムネを持つノートを引かない (画像が優先)', async () => {
    // Arrange
    const withImage = makeItem('1', `写真\n![](/api/images/${IMAGE})\n${fence('A')}`)

    // Act
    const map = await loadCircuitThumbs([withImage], 'first')

    // Assert
    expect(map).toEqual({})
    expect(queryRaw).not.toHaveBeenCalled()
  })

  test('all では画像サムネを持つノートの回路図も引く (タイルは併記)', async () => {
    // Arrange
    queryRaw.mockResolvedValue(stored(A))
    const withImage = makeItem('1', `写真\n![](/api/images/${IMAGE})\n${fence('A')}`)

    // Act / Assert
    expect(await loadCircuitThumbs([withImage], 'all')).toEqual({ '1': [A] })
  })
})

describe('キャッシュとの突き合わせ', () => {
  test('描画済みの図の hash を本文の出現順に返す (DB の返却順に依らない)', async () => {
    // Arrange
    queryRaw.mockResolvedValue(stored(B, A))

    // Act
    const map = await loadCircuitThumbs([makeItem('1', `${fence('A')}\n\n${fence('B')}`)], 'all')

    // Assert
    expect(map).toEqual({ '1': [A, B] })
  })

  test('未描画の図は黙って飛ばし、first は最初に描画済みの 1 枚にする', async () => {
    // Arrange
    queryRaw.mockResolvedValue(stored(B))
    const memo = `${fence('A')}\n\n${fence('B')}`

    // Act / Assert
    expect(await loadCircuitThumbs([makeItem('1', memo)], 'all')).toEqual({ '1': [B] })
    expect(await loadCircuitThumbs([makeItem('1', memo)], 'first')).toEqual({ '1': [B] })
  })

  test('全部未描画のノートはキーごと出ない', async () => {
    // Act / Assert
    expect(await loadCircuitThumbs([makeItem('1', fence('A'))], 'all')).toEqual({})
  })

  test('同じ図を持つ複数ノートに同じ hash が付き、hash は重複なしで引く', async () => {
    // Arrange
    queryRaw.mockResolvedValue(stored(A))

    // Act
    const map = await loadCircuitThumbs([makeItem('1', fence('A')), makeItem('2', fence('A'))], 'all')

    // Assert
    expect(map).toEqual({ '1': [A], '2': [A] })
    expect(queryRaw.mock.calls[0][0][0]).toEqual([A])
  })

  test('9 個目以降のフェンスは引きにも行かない (描画側の上限と同じ 8 個)', async () => {
    // Arrange
    const sources = Array.from({ length: 9 }, (_, i) => `S${i}`)
    queryRaw.mockResolvedValue(stored(...sources.map((s) => circuitHash(s))))

    // Act
    await loadCircuitThumbs([makeItem('1', sources.map(fence).join('\n\n'))], 'all')

    // Assert
    expect(queryRaw.mock.calls[0][0][0]).toHaveLength(8)
  })

  test('DB が落ちていても空を返す (一覧自体は出る)', async () => {
    // Arrange
    queryRaw.mockRejectedValue(new Error('down'))

    // Act / Assert
    expect(await loadCircuitThumbs([makeItem('1', fence('A'))], 'all')).toEqual({})
  })

  test('1 枚の上限を超える SVG は飛ばす', async () => {
    // Arrange
    queryRaw.mockResolvedValue([
      { hash: A, bytes: MAX_CIRCUIT_THUMB_BYTES + 1 },
      { hash: B, bytes: MAX_CIRCUIT_THUMB_BYTES },
    ])

    // Act
    const map = await loadCircuitThumbs([makeItem('1', `${fence('A')}\n\n${fence('B')}`)], 'all')

    // Assert
    expect(map).toEqual({ '1': [B] })
  })
})
