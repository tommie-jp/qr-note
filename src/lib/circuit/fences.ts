import {
  CIRCUITIKZ_LANG,
  CIRCUIT_LANG,
  CIRCUIT_LANGS,
  type CircuitLang,
  circuitKey,
  isCircuitLang,
} from '../markdown/fenceLanguages'
import { extractFences, uniqueBy } from '../markdown/extractFences'

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
// (ズレると描画済みの図を引けずコードブロックのまま出てしまう。
// 解析そのものは markdown/extractFences.ts が matrix・health と共有する)。
//
// 言語を指定すればその 1 つだけ、省けば回路になる全部を**本文に出てくる順**で
// 返す。順が要るのは 1 メモあたりの枚数上限 (MAX_CIRCUITS_PER_MEMO) が
// 2 言語の合算で、9 枚目から先を落とすときに「後ろから」でなければ
// 書いた人の期待と食い違うため。
//
// matrix・health と違い、中身が空のフェンスは捨て、重複の鍵には言語を混ぜる
// (circuitKey。同じ文字列でも言語が違えば別の図)
export function extractCircuitFences(
  markdown: string,
  lang?: CircuitLang,
): CircuitFence[] {
  const isTarget = (candidate: unknown): candidate is CircuitLang =>
    isCircuitLang(candidate) && (lang === undefined || candidate === lang)
  return uniqueBy(
    extractFences(markdown, isTarget).filter((fence) => fence.source !== ''),
    (fence) => circuitKey(fence.lang, fence.source),
  )
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
