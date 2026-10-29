// GFM の脚注だけを読む remark のプラグイン (docs/122 §2)。抽出用の parser が使う。
//
// remark-gfm から表を外したいが、**脚注は外せない**。脚注の定義の続き (字下げ 4 つ)
// に置いたフェンスは、脚注の拡張が無いと「字下げのコード」になり、フェンスとして
// 拾えなくなる。remark-gfm に部品を選ぶ設定は無いので、同じ部品を直接読む。
// 版は remark-gfm が持つ物と揃えてある (package.json)
import { gfmFootnoteFromMarkdown } from 'mdast-util-gfm-footnote'
import { gfmFootnote } from 'micromark-extension-gfm-footnote'
import type { Processor } from 'unified'

export function remarkFootnotes(this: Processor): undefined {
  const data = this.data()
  ;(data.micromarkExtensions ??= []).push(gfmFootnote())
  ;(data.fromMarkdownExtensions ??= []).push(gfmFootnoteFromMarkdown())
}
