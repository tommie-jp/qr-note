import type { Code, Root } from 'mdast'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import { CIRCUITIKZ_LANG, CIRCUIT_LANG } from './fenceLanguages'

// memo 本文で回路図を書くときのフェンス言語 (定義は fenceLanguages に集約)
export { CIRCUITIKZ_LANG, CIRCUIT_LANG }

// 回路図になるフェンスは 2 つある (docs/91)。素の TeX を書く circuitikz と、
// YAML を書く circuit。**描画の道筋が違う** (YAML は先に compileCircuit を
// 通す) ので、取り出したものには必ず言語が付いて回る
export const CIRCUIT_LANGS = [CIRCUITIKZ_LANG, CIRCUIT_LANG] as const
export type CircuitLang = (typeof CIRCUIT_LANGS)[number]

// 取り出した 1 つのフェンス。source は trim 済み
export interface CircuitFence {
  readonly lang: CircuitLang
  readonly source: string
}

// 描画結果を引くときの鍵。**言語を混ぜる**のが要点 — 同じ文字列が
// 2 つの言語で書かれても別の図なので、本文だけを鍵にすると片方の図が
// もう片方の場所に出る。DB のキャッシュキー (circuitHash) とは別物で、
// あちらは版を混ぜる
export function circuitKey(lang: CircuitLang, source: string): string {
  return `${lang}\n${source}`
}

// 本文から回路フェンスの中身を重複なしで取り出す。
// 正規表現ではなく remark でパースするのは、フェンスの入れ子や
// インデントの解釈を react-markdown 側と必ず一致させるため
// (ズレると描画済みの図を引けずコードブロックのまま出てしまう)。
//
// 言語を指定すればその 1 つだけ、省けば回路になる全部を**本文に出てくる順**で
// 返す。順が要るのは 1 メモあたりの枚数上限 (MAX_CIRCUITS_PER_MEMO) が
// 2 言語の合算で、9 枚目から先を落とすときに「後ろから」でなければ
// 書いた人の期待と食い違うため
export function extractCircuitFences(
  markdown: string,
  lang?: CircuitLang,
): CircuitFence[] {
  const tree = unified().use(remarkParse).parse(markdown) as Root
  const fences: CircuitFence[] = []
  const seen = new Set<string>()

  visit(tree, 'code', (node: Code) => {
    const nodeLang = CIRCUIT_LANGS.find((candidate) => candidate === node.lang)
    if (nodeLang === undefined || (lang !== undefined && nodeLang !== lang)) {
      return
    }
    const source = node.value.trim()
    const key = circuitKey(nodeLang, source)
    if (source && !seen.has(key)) {
      seen.add(key)
      fences.push({ lang: nodeLang, source })
    }
  })

  return fences
}

// ```circuitikz フェンスの中身だけ。言語を意識しない既存の経路が使う
export function extractCircuitSources(markdown: string): string[] {
  return extractCircuitFences(markdown, CIRCUITIKZ_LANG).map(
    (fence) => fence.source,
  )
}

// 本文が回路フェンスを 1 つも含まないと**確実に**言えるか。
//
// remark の解析は全ノートに掛けると安くないので、その前の足切りに使う
// (``` でも ~~~ でも言語名は本文に現れる)。`circuit` は `circuitikz` の
// 接頭辞なので、この 1 語を探せば 2 つの言語の両方に効く
export function hasNoCircuitFence(memo: string): boolean {
  return !memo.includes(CIRCUIT_LANG)
}
