// 回路図 SVG キャッシュの主キーと、出力 SVG の検査 (docs/93-リファクタリング計画.md §2-2)。
//
// 描画の本体 (circuitikz.ts) から切り出した純粋関数だけを置く。あちらは
// node:child_process で TeX を起動するので、鍵を計算したいだけの読み手
// (circuitThumbs.ts・offline/syncItems.ts) まで子プロセスの
// 起動部を抱え込まないようにする。**このファイルに child_process や prisma を
// 足さないこと** (node:crypto だけを使う)

import { createHash } from 'node:crypto'
import { CircuitRenderError } from './renderError'

// キャッシュキーに混ぜるレンダラの版。
// node-tikzjax の更新やプリアンブル (circuitikz.ts) の変更で出力が変わったら手で上げる
// (上げ忘れると古い SVG が返り続ける)
export const RENDERER_VERSION = 'tikzjax-1.0.5-2'

// 本文 + レンダラ版から決まる、キャッシュの主キー。
//
// **改行コードは揃えてから混ぜる** (docs/85-回路図表示待ち計画.md §6)。
// 同じ図の同じソースが、経路によって CRLF と LF の 2 通りで届く:
//   - 閲覧 … DB の本文そのまま (取り込んだファイルが CRLF ならそのまま残る)
//   - 編集のライブプレビュー … CodeMirror が読み書きする時点で LF に揃う
// TeX の出力は改行コードに依らず 1 バイトも変わらない (実測: 同じ SVG の
// md5 が一致) のに、混ぜると別の鍵になり同じ図を 2 度描いて 2 行溜める。
// いちばん高い処理を丸ごと二重に払っていた
export function circuitHash(source: string, version = RENDERER_VERSION): string {
  const normalized = source.replace(/\r\n?/g, '\n')
  return createHash('sha256').update(`${version}\n${normalized}`).digest('hex')
}

// TikZJax が実際に出力する要素。多様な回路 (抵抗・トランジスタ・op-amp・
// ダイオード・接地) で調べたところ svg / g / defs / style / path / text の
// 6 種類しか現れないが、図形系は将来出てき得るので少し広めに許す
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
// uploads.ts が「SVG はスクリプトを埋め込めるため」アップロードを拒んでいる以上、
// 生成物とはいえ dangerouslySetInnerHTML に無検査で流すのは方針に反する。
//
// 危険なものを消す (ブロックリスト) のではなく、想定外なら丸ごと捨てる
// (許可リスト) 方式にしている。消す方式は書き漏らしがそのまま穴になり、
// 実際 <script/> の自己閉じタグや <set attributeName="onload"> のような
// SMIL 経由の指定を取り逃がしていた。判断に迷うものは通さない側に倒す
export function assertSafeCircuitSvg(svg: string): string {
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
