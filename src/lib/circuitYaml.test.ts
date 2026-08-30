import { beforeEach, describe, expect, test, vi } from 'vitest'

// DB と TeX の実描画は差し替えて、compile → 描画 → 仕上げ → キャッシュの
// 分岐だけを見る。compileCircuit は本物を使う (circuit-fence の同期の純関数で、
// 差し替えると「どの版でどう返るか」というこの層の要点が見えなくなる)
const findUnique = vi.fn()
const create = vi.fn()
const renderCircuitDocument = vi.fn()

vi.mock('./db', () => ({
  prisma: {
    circuitSvg: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      create: (...a: unknown[]) => create(...a),
    },
  },
}))

vi.mock('./circuitikz', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./circuitikz')>()
  return {
    ...actual,
    renderCircuitDocument: (...a: unknown[]) => renderCircuitDocument(...a),
  }
})

const { renderCircuitYaml, circuitYamlHash } = await import('./circuitYaml')

// 描けるいちばん短い図
const SOURCE = `parts:
  R1: resistor a1 a3 10k`

// TikZJax が返す形に寄せた最小の SVG。仕上げ (塗り替え・刻印) が
// 当たったことを属性で見分けられるようにしておく
const RAW_SVG = '<svg width="100" height="50"><path stroke="currentColor"/></svg>'

beforeEach(() => {
  vi.clearAllMocks()
  findUnique.mockResolvedValue(null)
  create.mockResolvedValue({})
  renderCircuitDocument.mockResolvedValue(RAW_SVG)
})

describe('renderCircuitYaml', () => {
  test('YAML を TeX にしてから描き、仕上げた SVG を返す', async () => {
    const result = await renderCircuitYaml(SOURCE)

    expect('svg' in result).toBe(true)
    // 完全な TeX 文書がそのまま渡る (プリアンブルを足さない)
    const tex = renderCircuitDocument.mock.calls[0]?.[0] as string
    expect(tex).toContain('\\usepackage{circuitikz}')
    expect(tex).toContain('\\end{document}')
    // 仕上げ (markSvg) が当たっている
    expect('svg' in result && result.svg).toContain('data-circuit-fence=')
  })

  test('読めなかった行は行番号つきのエラーにする (TeX まで行かない)', async () => {
    const result = await renderCircuitYaml(`parts:
  R1: resistor a1 zz9 10k`)

    expect('error' in result).toBe(true)
    expect('error' in result && result.error).toMatch(/2 行目/)
    // 描画は始めない — 読めない図に TeX を 1 秒使う理由がない
    expect(renderCircuitDocument).not.toHaveBeenCalled()
  })

  test('キャッシュにあれば描かない', async () => {
    findUnique.mockResolvedValue({ svg: '<svg data-circuit-fence="x"></svg>' })

    const result = await renderCircuitYaml(SOURCE)

    expect('svg' in result).toBe(true)
    expect(renderCircuitDocument).not.toHaveBeenCalled()
  })

  test('キャッシュの鍵は改行コードの違いを吸収する', () => {
    const hash = circuitYamlHash(SOURCE)

    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    // 閲覧は DB の本文そのまま (CRLF が残りうる)、編集プレビューは
    // CodeMirror が LF に揃えた後。同じ図を 2 度描かせない
    expect(circuitYamlHash(SOURCE.replace(/\n/g, '\r\n'))).toBe(hash)
  })

  test('circuitikz フェンスと鍵がぶつからない', async () => {
    const { circuitHash } = await import('./circuitikz')

    // 同じ本文でも言語が違えば別の図。版の綴りが違うので鍵も分かれる
    expect(circuitYamlHash(SOURCE)).not.toBe(circuitHash(SOURCE))
  })
})

describe('お知らせ (notices)', () => {
  // 効かなかった指定 (グリッドを出していないのに grid-to を書いた)。
  // 図は問題なく描けるが、書いたとおりには出ていないので伝える
  const AMBIGUOUS = `parts:
  R1: resistor a1 a3 10k
style:
  grid-to: e5`

  test('図は描けるが伝えたいことがあれば notices に載せる', async () => {
    const result = await renderCircuitYaml(AMBIGUOUS)

    expect('svg' in result).toBe(true)
    expect(result.notices?.length ?? 0).toBeGreaterThan(0)
    expect(result.notices?.[0]?.message).toBeTruthy()
  })

  test('style: debug: off の図は notices を出さない', async () => {
    const result = await renderCircuitYaml(`${AMBIGUOUS}
  debug: off`)

    expect('svg' in result).toBe(true)
    // 承知のうえでそう書いた図なので黙る。**数えてはいる** (compileCircuit は
    // 返し続ける) が、出すかどうかを決めるのはこちら側の仕事
    expect(result.notices ?? []).toEqual([])
  })

  test('debug: off でも読めなかった行は必ず出す', async () => {
    const result = await renderCircuitYaml(`style:
  debug: off
parts:
  R1: resistor a1 zz9 10k`)

    expect('error' in result).toBe(true)
  })
})

// docs/91 §2 で「実装時にもテストとして残す」と決めた検査。
//
// 注釈 (`notes:`) の日本語は TeX を通らず、仕上げのときに SVG へ
// 直接差し込まれる。つまり **assertSafeCircuitSvg だけが関門**で、
// core が出す属性が許可リストから外れた日にここで止まる
describe('注釈を差し込んだ SVG が許可リストを通る', () => {
  test('日本語の注釈つきで仕上げても検査を通る', async () => {
    const { compileCircuit, finishSvg } = await import('circuit-fence/core')
    const { assertSafeCircuitSvg } = await import('./circuitikz')

    const compiled = compileCircuit(`parts:
  R1: resistor a1 a3 10k
notes:
  - text a5: 抵抗にかかる電圧
  - circle R1 red`)
    expect(compiled.errors).toEqual([])

    // 注釈は TeX が置いた**目印**を字に置き換える形で入る (#fe00fe の X)。
    // 目印の無い SVG を渡すと 1 文字も差し込まれず、検査するものが無くなる
    const marked =
      '<svg><path stroke="currentColor"/>' +
      '<text x="10" y="20" fill="#fe00fe">X</text>' +
      '<text x="30" y="40" fill="#fe00fe">X</text>' +
      '</svg>'
    const finished = finishSvg(marked, {
      notes: compiled.notes,
      theme: compiled.theme,
      width: compiled.width,
    })

    // 日本語が実際に差し込まれたことを確かめてから検査する
    expect(finished).toContain('抵抗にかかる電圧')
    expect(compiled.tex).toContain('\\usepackage{circuitikz}')
    expect(() => assertSafeCircuitSvg(finished)).not.toThrow()
  })
})
