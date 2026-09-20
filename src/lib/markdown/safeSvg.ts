// 生成した SVG が「絵」だけであることを確かめる許可リスト。
//
// **もとは circuit/hash.ts にあった。** あちらは `server-only` で、鍵の計算に
// node:crypto を使う。実体配線図 (breadboard / perfboard) はブラウザで描く
// ので、検査だけをここへ出して両方から使う (docs/97)。
// **写しを作らない**のが要点 — 同じ検査が 2 か所にあると、片方だけ直したときに
// 穴が開く。circuit 側は hash.ts が再輸出したものを今までどおり呼ぶ。
//
// **このファイルに server-only / node: を足さないこと** (ブラウザで動かす)。

import { CircuitRenderError } from '../circuit/renderError'

// TikZJax が実際に出力する要素。多様な回路 (抵抗・トランジスタ・op-amp・
// ダイオード・接地) で調べたところ svg / g / defs / style / path / text の
// 6 種類しか現れないが、図形系は将来出てき得るので少し広めに許す。
// 板の 2 つが出すのは svg / g / rect / circle / line / path / text だけで、
// どれもこの中に入る (実測 2026-09-21)
const ALLOWED_ELEMENTS = new Set([
  'svg', 'g', 'defs', 'style', 'path', 'text', 'tspan', 'use', 'symbol',
  'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'clippath', 'mask', 'lineargradient', 'radialgradient', 'stop', 'marker',
  'pattern', 'title', 'desc',
])

// style の @import で参照してよい唯一の URL (自前配信のフォント)
const ALLOWED_URL = '/tikzjax/fonts.css'

// 出力 SVG が想定どおりの「絵」だけであることを確かめる。違えば描画エラーにする。
//
// uploads/names.ts が「SVG はスクリプトを埋め込めるため」アップロードを拒んでいる以上、
// 生成物とはいえ dangerouslySetInnerHTML に無検査で流すのは方針に反する。
//
// 危険なものを消す (ブロックリスト) のではなく、想定外なら丸ごと捨てる
// (許可リスト) 方式にしている。消す方式は書き漏らしがそのまま穴になり、
// 実際 <script/> の自己閉じタグや <set attributeName="onload"> のような
// SMIL 経由の指定を取り逃がしていた。判断に迷うものは通さない側に倒す
export function assertSafeSvg(svg: string): string {
  // タグを 1 つずつ見る。属性値の中の < > に釣られないよう、
  // 引用符で囲まれた部分をまとめて読み飛ばす
  const tags = svg.matchAll(/<\/?\s*([a-zA-Z][\w:.-]*)((?:[^<>"']|"[^"]*"|'[^']*')*)\/?>/g)

  for (const [, name, rawAttrs] of tags) {
    if (!ALLOWED_ELEMENTS.has(name.toLowerCase())) {
      throw new CircuitRenderError(`想定外の SVG 要素 <${name}> が含まれていました`)
    }

    const attrs = rawAttrs.matchAll(
      /([a-zA-Z][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g,
    )
    for (const [, attr, dq, sq, bare] of attrs) {
      const attrName = attr.toLowerCase()
      const value = dq ?? sq ?? bare ?? ''

      // onload= などのイベントハンドラ
      if (attrName.startsWith('on')) {
        throw new CircuitRenderError(`想定外の SVG 属性 ${attr} が含まれていました`)
      }
      // <use href="#glyph"> のような内部参照だけを許す
      if ((attrName === 'href' || attrName.endsWith(':href')) && !value.startsWith('#')) {
        throw new CircuitRenderError(`想定外の SVG 参照 ${attr}="${value}" が含まれていました`)
      }
      if (/javascript\s*:/i.test(value)) {
        throw new CircuitRenderError('SVG に javascript: が含まれていました')
      }
    }
  }

  // <style> の中身はタグではないので上の検査に掛からない。
  // 外部を読みに行く url() が紛れ込んでいないか別途見る
  for (const [, url] of svg.matchAll(/url\(\s*['"]?([^'")]*)/gi)) {
    if (url.trim() !== ALLOWED_URL && !url.startsWith('#')) {
      throw new CircuitRenderError(`想定外の SVG 参照 url(${url}) が含まれていました`)
    }
  }

  return svg
}
