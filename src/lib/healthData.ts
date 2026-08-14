// ```health フェンスを折れ線のデータにする (docs/83-健康管理フェンス計画.md §5)。
//
// 進捗の表 (matrixData.ts) と同じ「事前計算を渡す」型。MarkdownView は同期に
// 描くので、非同期の集計はページ側でここを await して済ませ、結果を prop で
// 渡す。鍵はフェンスの中身 (trim 済み) で、同じ内容のフェンスが 2 つあれば
// 1 回の集計を共有する。

import type { Code, Root } from 'mdast'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import { HEALTH_LANG } from './fenceLanguages'
import { parseHealthFence } from './healthFence'
import { buildHealthSeries, type HealthSeries } from './healthSeries'
import { searchItemHealth, type ItemHealthResult } from './items'
import { requireUser } from './session'

// 1 つのメモに置けるグラフの上限 (MAX_MATRICES_PER_MEMO と同じ考え方・同じ数)。
// 1 枚につき 1 クエリ走るので、上限が無いと 1 ノートで DB を殴れる。
// ただし**同じ検索式のフェンスはクエリを共有する** (下の queryCache) ため、
// 実際に飛ぶクエリは「フェンスの数」ではなく「検索式の種類」で決まる。
// 体重と体温を並べる使い方 (検索式は同じで y= だけ違う) が典型なので、
// この共有が効く場面のほうが多い
export const MAX_HEALTH_CHARTS_PER_MEMO = 10

// 1 つの ```health フェンスの結果。成功か失敗のどちらか
export type HealthResult =
  | {
      kind: 'chart'
      series: HealthSeries
      // 0 件のときに「何を探したか」を添えるための検索式 (書かれたまま)
      query: string
      // 上限を超えて本文を読まなかったノート数
      omittedNotes: number
    }
  | { kind: 'error'; error: string }

// フェンスの中身 (trim 済み) → グラフ
export type HealthMap = ReadonlyMap<string, HealthResult>

// 本文から ```health フェンスの中身を重複なしで取り出す。
// 正規表現ではなく remark で解析するのは extractMatrixSources と同じ理由
// (react-markdown 側の解釈とズレると、集計済みのグラフを引けない)
export function extractHealthSources(markdown: string): string[] {
  const tree = unified().use(remarkParse).parse(markdown) as Root
  const sources: string[] = []

  visit(tree, 'code', (node: Code) => {
    if (node.lang !== HEALTH_LANG) {
      return
    }
    // 中身が空でもグラフは作れる (検索式なし = 全ノートから記録を拾う) ので、
    // 回路図と違い空を捨てない。鍵は '' になる
    const source = node.value.trim()
    if (!sources.includes(source)) {
      sources.push(source)
    }
  })

  return sources
}

// 本文中のすべての ```health フェンスを集計してマップにする。
//
// **ログイン必須** (計画 §8)。線の元になる数値はそのノート 1 枚の外から
// 集まるので、進捗の表 (docs/77 §6) とまったく同じ危険がある — むしろ
// 体重・血圧は学習状況より取り返しがつかない。公開ビューへ渡さないという
// 実装時の判断だけに頼らず、ここで requireUser() を通して落とす。
//
// 1 つ失敗しても他のグラフと本文は出したいので、失敗はマップに畳んで返す
// (投げ返さない)。ただし認証だけは畳まない — 静かに空のグラフを出すより、
// 落ちて気づけるほうがよい。
export async function buildHealthCharts(markdown: string): Promise<HealthMap> {
  const sources = extractHealthSources(markdown)
  const results = new Map<string, HealthResult>()
  if (sources.length === 0) {
    return results
  }

  await requireUser()

  for (const source of sources.slice(MAX_HEALTH_CHARTS_PER_MEMO)) {
    results.set(source, {
      kind: 'error',
      error: `1 つのノートに置けるグラフは ${MAX_HEALTH_CHARTS_PER_MEMO} 個までです`,
    })
  }

  // 同じ検索式のフェンスは 1 回のクエリを共有する。**Promise を鍵に入れる**
  // のが要点で、結果を入れる作りだと Promise.all で同時に走る 2 枚が
  // どちらもキャッシュを外し、同じクエリが 2 回飛ぶ
  const queryCache = new Map<string, Promise<ItemHealthResult>>()
  const rowsFor = (query: string): Promise<ItemHealthResult> => {
    const pending = queryCache.get(query)
    if (pending !== undefined) {
      return pending
    }
    const started = searchItemHealth(query)
    queryCache.set(query, started)
    return started
  }

  const built = await Promise.all(
    sources
      .slice(0, MAX_HEALTH_CHARTS_PER_MEMO)
      .map(async (source): Promise<[string, HealthResult]> => {
        const spec = parseHealthFence(source)
        if ('error' in spec) {
          return [source, { kind: 'error', error: spec.error }]
        }
        const { rows, omitted } = await rowsFor(spec.query)
        return [
          source,
          {
            kind: 'chart',
            series: buildHealthSeries(rows, spec.item, spec.days),
            query: spec.query,
            omittedNotes: omitted,
          },
        ]
      }),
  )
  for (const [source, result] of built) {
    results.set(source, result)
  }

  return results
}
