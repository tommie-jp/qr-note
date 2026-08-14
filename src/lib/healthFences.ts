import type { Code, Root } from 'mdast'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import { HEALTH_LANG } from './fenceLanguages'

// memo 本文で健康グラフを書くときのフェンス言語 (定義は fenceLanguages に集約)
export { HEALTH_LANG }

// 本文から ```health フェンスの中身を重複なしで取り出す。
//
// 正規表現ではなく remark で解析するのは extractCircuitSources と同じ理由
// (フェンスの入れ子やインデントの解釈を react-markdown 側と必ず一致させる。
// ズレると集計済みのグラフを引けず、コードブロックのまま出てしまう)。
//
// 集計 (healthData.ts) から切り離した葉モジュールに置くのは、**DB を持ち込まず
// テストできるようにする**ため。ここが返す文字列がそのまま集計結果の鍵になり、
// 描く側は readFence が読んだ中身で引くので、両者の畳み方が食い違うと静かに
// 壊れる — その一致こそ試したい場所であって、DB の有無とは関係がない
// (circuitFences.ts と同じ切り方)
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
