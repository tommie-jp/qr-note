import { describe, expect, test } from 'vitest'
import { CircuitRenderError, circuitHash, assertSafeCircuitSvg } from './circuitikz'

// **TeX を回さない**ぶんだけをここに置く。実際に描画するテストは重く、
// 置き場所を分けてある (どれも「なぜ別ファイルか」を各ヘッダに書いた):
//   - circuitikz.render.test.ts     … renderCircuit の描画
//   - circuitikz.timeout.test.ts    … 暴走 TeX の打ち切り (丸ごと 10 秒待つ)
//   - circuitikz.injection.test.ts  … dvisvgm:raw の注入口

const SIMPLE = String.raw`\begin{circuitikz}
\draw (0,0) to[R=$R_1$] (2,0);
\end{circuitikz}`

const DIVIDER = String.raw`\begin{circuitikz}
\draw (0,0) to[isource, l=$I_0$] (0,3) to[short, -*] (2,3)
  to[R=$R_1$] (2,0) -- (0,0);
\end{circuitikz}`

describe('circuitHash', () => {
  test('is stable for the same source', () => {
    expect(circuitHash(SIMPLE)).toBe(circuitHash(SIMPLE))
  })

  test('differs for different sources', () => {
    expect(circuitHash(SIMPLE)).not.toBe(circuitHash(DIVIDER))
  })

  test('is a hex digest usable as a primary key', () => {
    expect(circuitHash(SIMPLE)).toMatch(/^[0-9a-f]{64}$/)
  })

  // 同じ図が閲覧 (DB の本文 = CRLF のことがある) と編集のライブプレビュー
  // (CodeMirror が LF に揃える) で別々に届く。TeX の出力は同じなのに
  // 鍵が分かれると、いちばん高い処理を二重に払う
  test('ignores the line ending so one figure keeps one key', () => {
    expect(circuitHash(SIMPLE.replace(/\n/g, '\r\n'))).toBe(circuitHash(SIMPLE))
    expect(circuitHash(SIMPLE.replace(/\n/g, '\r'))).toBe(circuitHash(SIMPLE))
  })

  // Wikimedia の Math 拡張はレンダラ版をキーに含めておらず、
  // レンダラ更新時にキャッシュが無効化されない。同じ轍を踏まない
  test('changes when the renderer version changes', () => {
    expect(circuitHash(SIMPLE, 'v1')).not.toBe(circuitHash(SIMPLE, 'v2'))
  })
})

describe('assertSafeCircuitSvg', () => {
  test('passes the drawing itself through unchanged', () => {
    const svg =
      '<svg viewBox="0 0 1 1"><g stroke="#000"><path d="M0 0"/></g><text x="1">R</text></svg>'
    expect(assertSafeCircuitSvg(svg)).toBe(svg)
  })

  test('allows the self-hosted font @import', () => {
    const svg = '<svg><defs><style>@import url(/tikzjax/fonts.css);</style></defs></svg>'
    expect(assertSafeCircuitSvg(svg)).toContain('/tikzjax/fonts.css')
  })

  // 以下はいずれも、旧「危険なものを消す」実装が実際に取り逃がしていたもの
  test('rejects script elements', () => {
    expect(() => assertSafeCircuitSvg('<svg><script>alert(1)</script></svg>')).toThrow(
      CircuitRenderError,
    )
  })

  test('rejects a self-closing script tag', () => {
    expect(() => assertSafeCircuitSvg('<svg><script xlink:href="data:,alert(1)"/></svg>')).toThrow(
      CircuitRenderError,
    )
  })

  test('rejects SMIL animation that assigns an event handler', () => {
    expect(() =>
      assertSafeCircuitSvg('<svg><set attributeName="onload" to="alert(1)"/></svg>'),
    ).toThrow(CircuitRenderError)
  })

  test('rejects javascript: links', () => {
    expect(() => assertSafeCircuitSvg('<svg><a href="javascript:alert(1)"/></svg>')).toThrow(
      CircuitRenderError,
    )
  })

  test('rejects event handler attributes', () => {
    expect(() => assertSafeCircuitSvg('<svg onload="alert(1)"><path/></svg>')).toThrow(
      CircuitRenderError,
    )
    expect(() => assertSafeCircuitSvg('<svg><path onclick=alert(2) /></svg>')).toThrow(
      CircuitRenderError,
    )
  })

  test('rejects foreignObject (任意の HTML を持ち込める)', () => {
    expect(() =>
      assertSafeCircuitSvg('<svg><foreignObject><img src=x onerror=alert(1)></foreignObject></svg>'),
    ).toThrow(CircuitRenderError)
  })

  test('rejects references to the outside world', () => {
    expect(() => assertSafeCircuitSvg('<svg><use href="https://evil.example/x"/></svg>')).toThrow(
      CircuitRenderError,
    )
    expect(() =>
      assertSafeCircuitSvg('<svg><style>@import url(https://evil.example/x.css);</style></svg>'),
    ).toThrow(CircuitRenderError)
  })

  test('allows internal references (glyph の再利用)', () => {
    const svg = '<svg><defs><path id="g1" d="M0 0"/></defs><use href="#g1"/></svg>'
    expect(assertSafeCircuitSvg(svg)).toBe(svg)
  })
})
