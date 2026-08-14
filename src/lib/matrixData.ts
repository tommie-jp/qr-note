// ```matrix フェンスを表のデータにする (docs/77-進捗マトリックス計画.md §5, §6)。
//
// 回路図 (circuitCache.ts の renderCircuits) と同じ「事前計算を渡す」型。
// MarkdownView は同期に描くので、非同期の集計はページ側でここを await して
// 済ませ、結果を prop で渡す。鍵はフェンスの中身 (trim 済み) で、
// 同じ内容のフェンスが 2 つあれば 1 回の集計を共有する。

import type { Code, Root } from 'mdast'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import { MATRIX_LANG } from './fenceLanguages'
import { searchItemChecks } from './items'
import { parseMatrixFence, type MatrixMarkSet } from './matrixFence'
import {
  buildMatrixTable,
  type CheckParseCache,
  type MatrixTableData,
} from './matrixTable'
import { narrowToChecks } from './search'
import { requireUser } from './session'
import type { Sort } from './validation'

// 1 つのメモに置ける表の上限。1 つの表につき 1 クエリ走るので、
// 上限が無いと 1 ノートで DB を殴れる (MAX_CIRCUITS_PER_MEMO と同じ考え方)
export const MAX_MATRICES_PER_MEMO = 4

// 1 つの ```matrix フェンスの結果。成功か失敗のどちらか
export type MatrixResult =
  | {
      kind: 'table'
      table: MatrixTableData
      // 行のリンクに載せる検索状態。表は一覧と同じ検索結果を別の形で
      // 見せているので、リンク先も一覧の行と揃える (PropsTable と同じ理由)。
      //
      // **フェンスに書いた式そのままではなく、`narrowToChecks` で「チェックを
      // 持つ」を足した式**を持つ。表の行の絞りは SQL 側 (HAS_TASKS) にしか
      // 無いので、素の式を渡すと開いた先の前後ナビが表より広い集合を歩く
      // (計画 §7)
      query: string
      sort: Sort
      // セルに出す記号 (`mark=`)。null なら既定 (✓ / ☐ / —)
      marks: MatrixMarkSet | null
    }
  | { kind: 'error'; error: string }

// フェンスの中身 (trim 済み) → 表
export type MatrixMap = ReadonlyMap<string, MatrixResult>

// 本文から ```matrix フェンスの中身を重複なしで取り出す。
// 正規表現ではなく remark で解析するのは extractCircuitSources と同じ理由
// (react-markdown 側の解釈とズレると、集計済みの表を引けない)
export function extractMatrixSources(markdown: string): string[] {
  const tree = unified().use(remarkParse).parse(markdown) as Root
  const sources: string[] = []

  visit(tree, 'code', (node: Code) => {
    if (node.lang !== MATRIX_LANG) {
      return
    }
    // 中身が空でも表は作れる (検索式なし = チェックを持つ全ノート) ので、
    // 回路図と違い空を捨てない。鍵は '' になる
    const source = node.value.trim()
    if (!sources.includes(source)) {
      sources.push(source)
    }
  })

  return sources
}

// 本文中のすべての ```matrix フェンスを集計してマップにする。
//
// **ログイン必須** (計画 §6)。表の中身はそのノート 1 枚の外から作られ、
// 非公開ノートの番号・タイトル・学習状況が並ぶ。これまでフェンスは自分の
// 本文しか映さなかったので「公開したノートに書いてあることだけが公開される」
// という不変条件があり、DB を引くこの表はそれを破る最初の描画物になる。
//
// 公開ビュー (PublicItemView) は**回路図のために renderCircuits を呼んで
// いる**ので、同じ場所にこれを並べたら漏れる。そこで「渡さない」という
// 実装時の判断だけに頼らず、ここで requireUser() を通して落とす。
//
// 1 つ失敗しても他の表と本文は出したいので、失敗はマップに畳んで返す
// (投げ返さない)。ただし認証だけは畳まない — 静かに空の表を出すより、
// 落ちて気づけるほうがよい。
export async function buildMatrices(markdown: string): Promise<MatrixMap> {
  const sources = extractMatrixSources(markdown)
  const results = new Map<string, MatrixResult>()
  if (sources.length === 0) {
    return results
  }

  await requireUser()

  for (const source of sources.slice(MAX_MATRICES_PER_MEMO)) {
    results.set(source, {
      kind: 'error',
      error: `1 つのノートに置ける表は ${MAX_MATRICES_PER_MEMO} 個までです`,
    })
  }

  // 本文の解析は表をまたいで使い回す。表が複数あるときは対象のノートが
  // 大きく重なる (`#電験三種` と `#電験三種 #難` など) ため
  const parseCache: CheckParseCache = new Map()

  const built = await Promise.all(
    sources
      .slice(0, MAX_MATRICES_PER_MEMO)
      .map(async (source): Promise<[string, MatrixResult]> => {
        const spec = parseMatrixFence(source)
        if ('error' in spec) {
          return [source, { kind: 'error', error: spec.error }]
        }
        const { rows, omitted } = await searchItemChecks(spec.query, spec.sort)
        return [
          source,
          {
            kind: 'table',
            table: buildMatrixTable(rows, spec.columns, omitted, parseCache),
            // 検索は素の式で行い (絞りは HAS_TASKS)、**リンクへ載せる式には
            // その絞りを書き足す**。同じ集合を SQL と検索式の 2 通りで
            // 表しているので、片方だけ変えないこと (計画 §7)
            query: narrowToChecks(spec.query),
            sort: spec.sort,
            marks: spec.marks,
          },
        ]
      }),
  )
  for (const [source, result] of built) {
    results.set(source, result)
  }

  return results
}
