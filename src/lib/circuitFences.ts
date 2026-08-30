import type { Code, Root } from 'mdast'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import { CIRCUITIKZ_LANG } from './fenceLanguages'

// memo 本文で回路図を書くときのフェンス言語 (定義は fenceLanguages に集約)
export { CIRCUITIKZ_LANG }

// 本文から ```circuitikz フェンスの中身を重複なしで取り出す。
// 正規表現ではなく remark でパースするのは、フェンスの入れ子や
// インデントの解釈を react-markdown 側と必ず一致させるため
// (ズレると描画済みの図を引けずコードブロックのまま出てしまう)
export function extractCircuitSources(markdown: string): string[] {
  const tree = unified().use(remarkParse).parse(markdown) as Root
  const sources: string[] = []

  visit(tree, 'code', (node: Code) => {
    if (node.lang !== CIRCUITIKZ_LANG) {
      return
    }
    const source = node.value.trim()
    if (source && !sources.includes(source)) {
      sources.push(source)
    }
  })

  return sources
}
