import type { Code, Root } from 'mdast'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import {
  CIRCUITIKZ_LANG,
  CIRCUIT_LANG,
  CIRCUIT_LANGS,
  type CircuitLang,
  circuitKey,
  isCircuitLang,
} from './fenceLanguages'

// 回路フェンスまわりの定義は fenceLanguages に集約 (client も読む葉モジュール)。
// 本文の解析が要る呼び出し側は、remark を抱えたこちらから一式を受け取れる
export { CIRCUITIKZ_LANG, CIRCUIT_LANG, CIRCUIT_LANGS, circuitKey, isCircuitLang }
export type { CircuitLang }

// 取り出した 1 つのフェンス。source は trim 済み。
// **描画の道筋が言語で違う** (YAML は先に compileCircuit を通す) ので、
// 取り出したものには必ず言語が付いて回る
export interface CircuitFence {
  readonly lang: CircuitLang
  readonly source: string
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
    if (!isCircuitLang(node.lang) || (lang !== undefined && node.lang !== lang)) {
      return
    }
    const nodeLang = node.lang
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
