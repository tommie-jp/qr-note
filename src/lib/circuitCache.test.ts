import { beforeEach, describe, expect, test, vi } from 'vitest'
import { circuitHash } from './circuitikz'
import { CIRCUITIKZ_LANG, CIRCUIT_LANG, circuitKey } from './circuitFences'

// DB と TeX の実描画は差し替えて、キャッシュの分岐だけを見る
const findUnique = vi.fn()
const create = vi.fn()
const renderCircuit = vi.fn()

vi.mock('./db', () => ({
  prisma: { circuitSvg: { findUnique: (...a: unknown[]) => findUnique(...a), create: (...a: unknown[]) => create(...a) } },
}))

vi.mock('./circuitikz', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./circuitikz')>()
  return { ...actual, renderCircuit: (...a: unknown[]) => renderCircuit(...a) }
})

const { getOrRenderCircuit, planCircuits, renderCircuits } = await import('./circuitCache')

const SOURCE = String.raw`\begin{circuitikz}\draw (0,0) to[R=$R_1$] (2,0);\end{circuitikz}`
const SVG = '<svg><path/></svg>'

// 描画結果の鍵は言語つき (circuitFences.circuitKey)。同じ本文が 2 つの
// 言語で書かれても取り違えないため
const tikz = (source: string) => circuitKey(CIRCUITIKZ_LANG, source)
const yaml = (source: string) => circuitKey(CIRCUIT_LANG, source)

describe('getOrRenderCircuit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('returns the cached SVG without rendering on a hit', async () => {
    findUnique.mockResolvedValue({ hash: circuitHash(SOURCE), svg: SVG })

    const svg = await getOrRenderCircuit(SOURCE)

    expect(svg).toBe(SVG)
    expect(renderCircuit).not.toHaveBeenCalled()
  })

  test('renders and stores the SVG on a miss', async () => {
    findUnique.mockResolvedValue(null)
    renderCircuit.mockResolvedValue(SVG)
    create.mockResolvedValue({})

    const svg = await getOrRenderCircuit(SOURCE)

    expect(svg).toBe(SVG)
    expect(renderCircuit).toHaveBeenCalledWith(SOURCE)
    expect(create).toHaveBeenCalledWith({
      data: { hash: circuitHash(SOURCE), svg: SVG },
    })
  })

  test('looks up by the version-salted hash', async () => {
    findUnique.mockResolvedValue({ svg: SVG })

    await getOrRenderCircuit(SOURCE)

    expect(findUnique).toHaveBeenCalledWith({ where: { hash: circuitHash(SOURCE) } })
  })

  // キャッシュは無くても再描画できる派生データ。DB が落ちていても図は出したい
  test('still renders when the cache read fails', async () => {
    findUnique.mockRejectedValue(new Error('db down'))
    renderCircuit.mockResolvedValue(SVG)

    expect(await getOrRenderCircuit(SOURCE)).toBe(SVG)
  })

  test('still returns the SVG when the cache write fails', async () => {
    findUnique.mockResolvedValue(null)
    renderCircuit.mockResolvedValue(SVG)
    create.mockRejectedValue(new Error('db down'))

    expect(await getOrRenderCircuit(SOURCE)).toBe(SVG)
  })

  test('propagates render errors instead of caching them', async () => {
    findUnique.mockResolvedValue(null)
    renderCircuit.mockRejectedValue(new Error('TeX error'))

    await expect(getOrRenderCircuit(SOURCE)).rejects.toThrow('TeX error')
    expect(create).not.toHaveBeenCalled()
  })

  // 検査を直したときに RENDERER_VERSION を上げ忘れても、危険な図が
  // キャッシュから素通りしないこと
  test('re-checks the cached SVG instead of trusting the row', async () => {
    findUnique.mockResolvedValue({ svg: '<svg><script>alert(1)</script></svg>' })

    await expect(getOrRenderCircuit(SOURCE)).rejects.toThrow(/想定外/)
  })

  // DB キャッシュは描き終わってから書かれるので、進行中を覚えていないと
  // 「保存後の先読み」と「その直後に開いた閲覧画面」が同じ図を 2 度描く
  test('shares one render between callers that ask at the same time', async () => {
    findUnique.mockResolvedValue(null)
    create.mockResolvedValue({})
    renderCircuit.mockResolvedValue(SVG)

    const [a, b] = await Promise.all([
      getOrRenderCircuit(SOURCE),
      getOrRenderCircuit(SOURCE),
    ])

    expect(a).toBe(SVG)
    expect(b).toBe(SVG)
    expect(renderCircuit).toHaveBeenCalledTimes(1)
  })

  // 失敗を覚えたままにすると、TeX を直した後も同じ失敗が返り続ける
  test('forgets a failed render so the next attempt runs again', async () => {
    findUnique.mockResolvedValue(null)
    renderCircuit.mockRejectedValue(new Error('TeX error'))

    await expect(getOrRenderCircuit(SOURCE)).rejects.toThrow('TeX error')
    await expect(getOrRenderCircuit(SOURCE)).rejects.toThrow('TeX error')
    expect(renderCircuit).toHaveBeenCalledTimes(2)
  })
})

describe('planCircuits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findUnique.mockResolvedValue(null)
    create.mockResolvedValue({})
    renderCircuit.mockResolvedValue(SVG)
  })

  // 待たずに返るのがこの関数の存在理由。await してしまうと本文が
  // 図の描き上がりまで 1 文字も出せない
  test('returns the map without waiting for the render', () => {
    const map = planCircuits('```circuitikz\nA\n```')

    expect(map.get(tikz('A'))).toBeInstanceOf(Promise)
  })

  test('resolves each fence to its rendered SVG', async () => {
    const map = planCircuits('```circuitikz\nA\n```\n\n```circuitikz\nB\n```\n')

    expect(await map.get(tikz('A'))).toEqual({ svg: SVG })
    expect(await map.get(tikz('B'))).toEqual({ svg: SVG })
  })

  // 誰も await しないまま解ける約束があるので (読者が描き上がる前に
  // ページを離れたとき)、reject させると unhandled rejection になる
  test('folds a failed render into the result instead of rejecting', async () => {
    renderCircuit.mockRejectedValue(new Error('TeX error'))

    const map = planCircuits('```circuitikz\nA\n```')

    expect(await map.get(tikz('A'))).toEqual({ error: 'TeX error', texLog: '' })
  })

  // 上限を超えた図は約束ですらない (描きにも行かない)
  test('caps the memo without starting the extra renders', async () => {
    const md = Array.from({ length: 12 }, (_, i) => `\`\`\`circuitikz\nC${i}\n\`\`\``).join('\n\n')

    const map = planCircuits(md)
    await Promise.all([...map.values()])

    expect(renderCircuit).toHaveBeenCalledTimes(8)
    expect(map.get(tikz('C8'))).toMatchObject({ error: expect.stringContaining('8 個まで') })
  })
})

describe('renderCircuits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findUnique.mockResolvedValue(null)
    create.mockResolvedValue({})
    renderCircuit.mockResolvedValue(SVG)
  })

  test('renders every fence in the memo', async () => {
    const md = '```circuitikz\nA\n```\n\n```circuitikz\nB\n```\n'

    const map = await renderCircuits(md)

    expect(map.get(tikz('A'))).toEqual({ svg: SVG })
    expect(map.get(tikz('B'))).toEqual({ svg: SVG })
  })

  test('folds a failed render into the map instead of throwing', async () => {
    renderCircuit.mockRejectedValue(new Error('TeX error'))

    const map = await renderCircuits('```circuitikz\nA\n```')

    expect(map.get(tikz('A'))).toEqual({ error: 'TeX error', texLog: '' })
  })

  // 1 枚ごとに最大 10 秒かかるため、際限なく並べられるとページが止まる
  test('caps how many circuits one memo can render', async () => {
    const md = Array.from({ length: 12 }, (_, i) => `\`\`\`circuitikz\nC${i}\n\`\`\``).join('\n\n')

    const map = await renderCircuits(md)

    expect(renderCircuit).toHaveBeenCalledTimes(8)
    expect(map.get(tikz('C7'))).toEqual({ svg: SVG })
    expect(map.get(tikz('C8'))).toMatchObject({ error: expect.stringContaining('8 個まで') })
  })
})

// 2 つの回路フェンス (circuitikz / circuit) が同じメモに並ぶとき
// (docs/91 §4)。走る TeX の重さは言語に依らないので、上限は合算で数える
describe('2 言語の共存', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findUnique.mockResolvedValue(null)
    create.mockResolvedValue({})
    renderCircuit.mockResolvedValue(SVG)
  })

  test('上限は circuitikz と circuit の合算で数える', async () => {
    // circuitikz を 6 枚 → circuit を 4 枚。合計 10 枚で上限 8 を超える
    const tikzFences = Array.from(
      { length: 6 },
      (_, i) => `\`\`\`circuitikz\nT${i}\n\`\`\``,
    )
    const yamlFences = Array.from(
      { length: 4 },
      (_, i) => `\`\`\`circuit\nparts:\n  R${i}: resistor a1 a3\n\`\`\``,
    )
    const map = planCircuits([...tikzFences, ...yamlFences].join('\n\n'))
    await Promise.all([...map.values()])

    // circuitikz が先に 6 枚。YAML は残りの 2 枚だけが描かれ、
    // 9・10 枚目は約束ですらない
    expect(renderCircuit).toHaveBeenCalledTimes(6)
    expect(map.get(yaml('parts:\n  R2: resistor a1 a3'))).toMatchObject({
      error: expect.stringContaining('8 個まで'),
    })
    expect(map.get(yaml('parts:\n  R3: resistor a1 a3'))).toMatchObject({
      error: expect.stringContaining('8 個まで'),
    })
  })

  test('同じ本文でも言語が違えば別の図として扱う', () => {
    // 中身は同じ 1 文字。鍵に言語が入っていないと、片方の図が
    // もう片方の場所に出る
    const map = planCircuits('```circuitikz\nA\n```\n\n```circuit\nA\n```\n')

    expect(map.has(tikz('A'))).toBe(true)
    expect(map.has(yaml('A'))).toBe(true)
    expect(map.size).toBe(2)
  })
})
