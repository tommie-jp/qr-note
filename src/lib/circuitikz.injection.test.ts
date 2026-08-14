import { describe, expect, test } from 'vitest'
import { CircuitRenderError, renderCircuit } from './circuitikz'

// dvi2html の \special{dvisvgm:raw ...} は中身をエスケープせず SVG へ流し込む。
// TeX の素の命令なのでパッケージも要らず、ここが任意マークアップの唯一の注入口。
// フェンスに web で拾った細工済みスニペットを貼られる筋があるので、
// 実際に描画させたうえで弾けることを確かめる (許可リストの本番相当の検証)。
//
// 描画を回すので 1 本あたり 1 秒前後かかる。テストファイルは vitest の並列単位
// なので、描画の本体 (circuitikz.render.test.ts) とは別ファイルにして同時に
// 走らせる (docs/80-デプロイ再高速化計画.md §9)。

// TeX の起動込みで 1 枚あたり 1〜2 秒かかるため、既定の 5 秒では足りない
const RENDER_TIMEOUT_MS = 30_000

describe('dvisvgm:raw injection', () => {
  const cases: Record<string, string> = {
    'javascript link': String.raw`\begin{tikzpicture}
\special{dvisvgm:raw <a xlink:href='javascript:alert(document.cookie)'><rect width='999' height='999' fill='red'/></a>}
\draw (0,0) -- (1,1);
\end{tikzpicture}`,
    'tracking beacon': String.raw`\begin{tikzpicture}
\special{dvisvgm:raw <image href='https://evil.example/beacon.png' width='1' height='1'/>}
\draw (0,0) -- (1,1);
\end{tikzpicture}`,
    'event handler': String.raw`\begin{tikzpicture}
\special{dvisvgm:raw <rect onload='alert(1)' width='9' height='9'/>}
\draw (0,0) -- (1,1);
\end{tikzpicture}`,
  }

  for (const [name, source] of Object.entries(cases)) {
    test(
      `rejects ${name}`,
      async () => {
        const error = await renderCircuit(source).catch((e: unknown) => e)
        expect(error).toBeInstanceOf(CircuitRenderError)
      },
      RENDER_TIMEOUT_MS,
    )
  }
})
