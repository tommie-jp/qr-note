import { describe, expect, test } from 'vitest'
import { CircuitRenderError, renderCircuit } from './circuitikz'

// renderCircuit の**実際に TeX を回す**ぶん。純粋関数のテストは circuitikz.test.ts。
//
// ファイルを分けているのは速さのため。vitest は forks プールで**ファイル単位に**
// 並列化するので、1 ファイルに置くと 1 プロセスの中で直列に流れる。しかも
// node-tikzjax はモジュール状態を持ち、同一プロセス内では circuitikz.ts の
// enqueue が呼び出しを 1 本の鎖に繋ぐため、**同じファイルにある限り絶対に
// 重ならない**。ファイルを分ければプロセスが分かれ、そのまま同時に走る。
//
// なぜ気にするか: ./doDeploy.sh の 3/8 は lint / test / build を並列に流すので、
// **一番長いテストファイルがそのままデプロイの律速になる**
// (docs/80-デプロイ再高速化計画.md §9)。
//
// TeX の起動込みで 1 枚あたり 1〜2 秒かかるため、既定の 5 秒では足りない
const RENDER_TIMEOUT_MS = 30_000

const SIMPLE = String.raw`\begin{circuitikz}
\draw (0,0) to[R=$R_1$] (2,0);
\end{circuitikz}`

const DIVIDER = String.raw`\begin{circuitikz}
\draw (0,0) to[isource, l=$I_0$] (0,3) to[short, -*] (2,3)
  to[R=$R_1$] (2,0) -- (0,0);
\end{circuitikz}`

describe('renderCircuit', () => {
  test(
    'renders a circuitikz source to SVG',
    async () => {
      // Arrange / Act
      const svg = await renderCircuit(SIMPLE)

      // Assert
      expect(svg).toMatch(/^<svg[\s>]/)
      expect(svg).toContain('</svg>')
      expect(svg).toContain('<path')
    },
    RENDER_TIMEOUT_MS,
  )

  test(
    'is deterministic for the same source',
    async () => {
      const [a, b] = [await renderCircuit(SIMPLE), await renderCircuit(SIMPLE)]
      expect(a).toBe(b)
    },
    RENDER_TIMEOUT_MS,
  )

  test(
    'references only self-hosted fonts (never a CDN)',
    async () => {
      const svg = await renderCircuit(DIVIDER)
      expect(svg).toContain('/tikzjax/fonts.css')
      expect(svg).not.toMatch(/jsdelivr|cdn\./)
    },
    RENDER_TIMEOUT_MS,
  )

  test(
    'throws CircuitRenderError with the TeX log on a syntax error',
    async () => {
      const broken = String.raw`\begin{circuitikz}
\draw (0,0) to[NOSUCHCOMPONENT=$R$] (2,0);
\end{circuitikz}`

      const error = await renderCircuit(broken).catch((e: unknown) => e)

      expect(error).toBeInstanceOf(CircuitRenderError)
      // 素の例外文言は役に立たないので、stdout から拾った原因行を載せる
      expect((error as CircuitRenderError).texLog).toContain('NOSUCHCOMPONENT')
    },
    RENDER_TIMEOUT_MS,
  )

  test(
    'serializes concurrent renders (node-tikzjax は同時実行できない)',
    async () => {
      const [a, b] = await Promise.all([
        renderCircuit(SIMPLE),
        renderCircuit(DIVIDER),
      ])

      expect(a).toMatch(/^<svg[\s>]/)
      expect(b).toMatch(/^<svg[\s>]/)
      expect(a).not.toBe(b)
    },
    RENDER_TIMEOUT_MS * 2,
  )
})

// circuitikz の op amp は +/- を 6pt の boldmath で組むが、TikZJax は
// cmmib5 を同梱しておらず、素のままだと TeX ごと落ちてオペアンプが
// 一切描けない。プリアンブルの回避策が効いていることを守る
test(
  'renders an op amp (cmmib5 が無くても落ちない)',
  async () => {
    const svg = await renderCircuit(String.raw`\begin{circuitikz}
\draw (0,0) node[op amp](OA){};
\draw (OA.out) to[short, -o] (2,0);
\end{circuitikz}`)

    expect(svg).toMatch(/^<svg[\s>]/)
    expect(svg).toContain('<path')
  },
  RENDER_TIMEOUT_MS,
)
