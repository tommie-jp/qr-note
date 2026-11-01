// 生成した SVG が「絵」だけであることを確かめる許可リスト。
//
// **もとは circuit/hash.ts にあった。** あちらは `server-only` で、鍵の計算に
// node:crypto を使う。実体配線図 (breadboard / perfboard) はブラウザで描く
// ので、検査だけをここへ出して両方から使う (docs/97)。
// **写しを作らない**のが要点 — 同じ検査が 2 か所にあると、片方だけ直したときに
// 穴が開く。circuit 側は hash.ts が再輸出したものを今までどおり呼ぶ。
//
// **このファイルに server-only / node: を足さないこと** (ブラウザで動かす)。
//
// 2026-11 のセキュリティ監査 (M-3) で、正規表現で開始タグを拾う作りから
// **XML として解析し、検査した木を組み立て直して返す**作りに改めた。
// 理由は 2 つ:
//   1. 正規表現と HTML パーサの不一致。`<text onclick="…" <text>` は閉じて
//      いない開始タグがタグとして数えられず素通りしたが、innerHTML に入れると
//      onclick が生きる (Chromium で実測)。XML として不正なものは入口で断り、
//      出力は解析した木から作る (検査した物と出す物を同じにする)
//   2. CSS の外部参照の見逃し。`url(` と `@import "…"` の形しか見ておらず、
//      `image-set(…)`・CSS エスケープ (`u\72l`)・`@\69mport` が通り、
//      \special{dvisvgm:raw …} 経由で読者のブラウザから外へ取りに行けた
// 解析は依存にある fast-xml-parser (純 JS。Node とブラウザの両方で動く)

import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser'
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

// fast-xml-parser (preserveOrder) の木の鍵
const TEXT = '#text'
const CDATA = '#cdata'
const ATTRIBUTES = ':@'

// 実体 (&lt; など) は**解かずに**そのまま往復させる (processEntities: false)。解いて
// 組み直すと、文字だった `<` が印に化ける余地ができる。宣言と処理命令は落とし、
// コメントも落とす (HTML の解釈で `-->` を悪用する余地を残さない)。
// CDATA は印のまま持ち、組み直しでも CDATA に戻す (中の `<` を素で出さない)
const PARSER_OPTIONS = {
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  processEntities: false,
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  allowBooleanAttributes: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
  cdataPropName: CDATA,
} as const

const BUILDER_OPTIONS = {
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  processEntities: false,
  suppressEmptyNode: true,
  cdataPropName: CDATA,
  format: false,
} as const

type Attributes = Readonly<Record<string, unknown>>
type Node = Readonly<Record<string, unknown>>

function fail(message: string): never {
  throw new CircuitRenderError(message)
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// 出力 SVG が想定どおりの「絵」だけであることを確かめる。違えば描画エラーにする。
// 通れば**解析した木から組み直した文字列**を返す (入力そのものではない)。
//
// uploads/names.ts が「SVG はスクリプトを埋め込めるため」アップロードを拒んでいる以上、
// 生成物とはいえ dangerouslySetInnerHTML に無検査で流すのは方針に反する。
//
// 危険なものを消す (ブロックリスト) のではなく、想定外なら丸ごと捨てる
// (許可リスト) 方式にしている。消す方式は書き漏らしがそのまま穴になり、
// 実際 <script/> の自己閉じタグや <set attributeName="onload"> のような
// SMIL 経由の指定を取り逃がしていた。判断に迷うものは通さない側に倒す
export function assertSafeSvg(svg: string): string {
  // 実体の定義 (DOCTYPE / ENTITY) は解析の前に断る。中身の置き換えで検査の
  // 後に文字が増える道を残さない
  if (/<!(?:DOCTYPE|ENTITY)/i.test(svg)) {
    fail('SVG に DOCTYPE / ENTITY が含まれていました')
  }
  const valid = XMLValidator.validate(svg, { allowBooleanAttributes: false })
  if (valid !== true) {
    fail(`SVG が XML として読めません (${valid.err.msg})`)
  }

  const nodes = new XMLParser(PARSER_OPTIONS).parse(svg) as unknown[]
  checkRoot(nodes)
  checkNodes(nodes)
  return new XMLBuilder(BUILDER_OPTIONS).build(nodes) as string
}

// 根は <svg> が 1 つ。前後に許すのは空白だけ
function checkRoot(nodes: readonly unknown[]): void {
  const elements = nodes.filter((node) => isNode(node) && nameOf(node) !== TEXT)
  if (elements.length !== 1 || nameOf(elements[0] as Node).toLowerCase() !== 'svg') {
    fail('SVG の根は <svg> 1 つでなければなりません')
  }
  for (const node of nodes) {
    if (isNode(node) && nameOf(node) === TEXT && String(node[TEXT]).trim() !== '') {
      fail('SVG の外に文字がありました')
    }
  }
}

function nameOf(node: Node): string {
  const names = Object.keys(node).filter((key) => key !== ATTRIBUTES)
  if (names.length !== 1) {
    fail('SVG の木の形が読めません')
  }
  return names[0]
}

function checkNodes(nodes: readonly unknown[]): void {
  for (const node of nodes) {
    if (!isNode(node)) {
      fail('SVG の木の形が読めません')
    }
    const name = nameOf(node)
    if (name === TEXT || name === CDATA) {
      continue
    }
    const lower = name.toLowerCase()
    if (!ALLOWED_ELEMENTS.has(lower)) {
      fail(`想定外の SVG 要素 <${name}> が含まれていました`)
    }
    const attributes = (node[ATTRIBUTES] ?? {}) as Attributes
    for (const [attribute, raw] of Object.entries(attributes)) {
      checkAttribute(attribute, String(raw))
    }
    const children = node[name]
    if (!Array.isArray(children)) {
      fail('SVG の木の形が読めません')
    }
    if (lower === 'style') {
      checkCss(textOf(children))
    }
    checkNodes(children)
  }
}

// <style> の中身 (文字と CDATA) を 1 本の CSS にする
function textOf(children: readonly unknown[]): string {
  return children
    .map((child) => {
      if (!isNode(child)) {
        return ''
      }
      const name = nameOf(child)
      if (name === TEXT) {
        return String(child[TEXT])
      }
      if (name === CDATA) {
        return textOf(child[CDATA] as unknown[])
      }
      return ''
    })
    .join('')
}

function checkAttribute(attribute: string, value: string): void {
  // 名前は小文字で比べる。XML は大文字小文字を区別するが、innerHTML で読む
  // HTML は区別しないので、ONCLICK も onclick として生きる
  const lower = attribute.toLowerCase()
  // onload= などのイベントハンドラ
  if (lower.startsWith('on')) {
    fail(`想定外の SVG 属性 ${attribute} が含まれていました`)
  }
  // <use href="#glyph"> のような内部参照だけを許す
  if ((lower === 'href' || lower.endsWith(':href')) && !value.startsWith('#')) {
    fail(`想定外の SVG 参照 ${attribute}="${value}" が含まれていました`)
  }
  if (/javascript\s*:/i.test(value)) {
    fail('SVG に javascript: が含まれていました')
  }
  if (lower === 'style') {
    checkCss(value)
  }
}

// CSS (style 属性と <style> の中身)。外を読みに行ける書き方を全部断る。
//
// url() と @import の形だけを見ていては足りない (監査 M-3 の実測):
//   image-set("https://…")   … url() を使わずに取りに行く
//   u\72l(https://…)          … CSS のエスケープで url を隠す
//   @\69mport "…"             … 同じく @import を隠す
// エスケープ (バックスラッシュ) は、正当な出力 (dvisvgm・vendor の板と計器) が
// 使わないので丸ごと断る。許すのは字体の @import 1 本 (docs/124 §1) と、
// 文書内参照の url(#…) だけ
function checkCss(css: string): void {
  if (css.includes('\\')) {
    fail('SVG の CSS にエスケープが含まれていました')
  }
  if (/image-set\s*\(|\bsrc\s*\(|expression\s*\(|-moz-binding|behavior\s*:/i.test(css)) {
    fail('SVG の CSS に外部を読む書き方が含まれていました')
  }
  for (const [, url] of css.matchAll(/url\(\s*['"]?([^'")]*)/gi)) {
    if (url.trim() !== ALLOWED_URL && !url.startsWith('#')) {
      fail(`想定外の SVG 参照 url(${url}) が含まれていました`)
    }
  }
  // url() を使わない @import ("…" の書き方) も外を読みに行ける。@import は
  // 字体の CSS を url() で読むものだけを許す (docs/124 §1。口から直に開くと
  // CSP が止めるが、画像表示のタイルはページに埋め込むのでこちらで断る)
  for (const [statement] of css.matchAll(/@import[^;]*/gi)) {
    const target = /^@import\s+url\(\s*['"]?([^'")]*)['"]?\s*\)\s*$/i.exec(statement.trim())?.[1]
    if (target?.trim() !== ALLOWED_URL) {
      fail(`想定外の SVG の読み込み ${statement.trim()} が含まれていました`)
    }
  }
}
