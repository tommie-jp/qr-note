import { describe, expect, test } from 'vitest'
import { assertSafeSvg } from './safeSvg'

// 2026-11 の監査 M-3 の回帰。許可リストの中身は circuit/hash.test.ts が見る。
// ここは「正規表現からパーサに替えた」ことで塞いだ 2 つの穴を固定する
const SVG = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${inner}</svg>`

describe('HTML パーサとの不一致 (a)', () => {
  test('閉じていない開始タグは XML として断る (innerHTML では onclick が生きる形)', () => {
    expect(() =>
      assertSafeSvg(SVG('<text x="10" y="50" onclick="window.__pwned=1" <text>click</text>')),
    ).toThrow(/XML として読めません/)
  })

  test('大文字の ONCLICK も断る (HTML は大文字小文字を区別しない)', () => {
    expect(() => assertSafeSvg(SVG('<rect ONCLICK="alert(1)"/>'))).toThrow(/想定外の SVG 属性/)
  })

  test('DOCTYPE / ENTITY は解析の前に断る', () => {
    expect(() => assertSafeSvg(`<!DOCTYPE svg [<!ENTITY x "y">]>${SVG('<rect/>')}`)).toThrow(/DOCTYPE/)
  })

  test('根が <svg> 1 つでなければ断る', () => {
    expect(() => assertSafeSvg(`${SVG('')}<rect/>`)).toThrow(/根は <svg>/)
    expect(() => assertSafeSvg('<rect/>')).toThrow(/根は <svg>/)
  })

  test('返すのは解析した木から組み直した文字列で、検査した物と同じ', () => {
    const out = assertSafeSvg(SVG('<g fill="#000"><text x="1">a &lt; b &amp; c</text><path d="M0 0" /></g>'))
    expect(out).toBe(SVG('<g fill="#000"><text x="1">a &lt; b &amp; c</text><path d="M0 0"/></g>'))
  })

  test('CDATA の <style> も往復で崩れない', () => {
    const inner = '<style><![CDATA[text{font-family:a;}]]></style>'
    expect(assertSafeSvg(SVG(inner))).toBe(SVG(inner))
  })
})

describe('CSS の外部参照 (b)', () => {
  test.each([
    ['image-set', 'cursor:image-set(\'https://attacker.example/b.png\' 1x),auto'],
    ['CSS エスケープの url', 'filter:u\\72l(https://attacker.example/f.svg)'],
    ['mask の image-set', "mask:image-set('https://attacker.example/m.png')"],
    ['expression', 'width:expression(alert(1))'],
  ])('style 属性の %s を断る', (_name, style) => {
    expect(() => assertSafeSvg(SVG(`<rect width="9" height="9" style="${style}"/>`))).toThrow(
      /SVG の CSS/,
    )
  })

  test('<style> の中のエスケープした @import を断る', () => {
    expect(() =>
      assertSafeSvg(SVG('<style>@\\69mport "https://attacker.example/x.css";</style>')),
    ).toThrow(/SVG の CSS にエスケープ/)
  })

  test('字体の @import と文書内の url(#…) は通す', () => {
    const inner =
      '<style>@import url(/tikzjax/fonts.css);</style><rect style="fill:url(#grad)" width="1"/>'
    expect(assertSafeSvg(SVG(inner))).toBe(SVG(inner))
  })

  test('<style> の外部 url は今までどおり断る', () => {
    expect(() =>
      assertSafeSvg(SVG('<style>text{background:url(https://attacker.example/a.png)}</style>')),
    ).toThrow(/想定外の SVG 参照/)
  })
})
