// Markdown → HTML の木 (hast) を本文ごとに覚えておく (docs/123 §11-4)。
//
// react-markdown の <Markdown> は描くたびに 解析 → 変換 → 部品 の 3 段を通す。
// 端末で描くようになってから、ノートを開くたびに前の 2 段 (remark・rehype と
// プラグイン一式) が走り、CPU の遅い端末では開くまでの大半になった。
// 前の 2 段は本文とプラグインの設定だけで決まるので、結果の木を覚えておき、
// 描くときは最後の段 (hast → React の要素) だけを通す。
//
// やっていることは react-markdown 10 の Markdown() (lib/index.js の
// createProcessor・post) と同じで、違うのは木を覚えることだけ:
//
//   - remark-rehype には allowDangerousHtml を付ける (raw を text に倒すため)
//   - raw ノードは text にする (skipHtml を使わないときの react-markdown の作法)
//   - URL を持つ属性は urlTransform を通す
//
// **木は書き換えない。** 覚えた木を次の描画でも使うので、部品 (components) は
// node を読むだけにする (今の部品はどれも読むだけ)。
//
// サーバ (公開ビュー) と端末の両方から読むので server-only も client-only も付けない
import type { Root } from 'hast'
import { toJsxRuntime, type Components } from 'hast-util-to-jsx-runtime'
import { urlAttributes } from 'html-url-attributes'
import type { ReactElement } from 'react'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'
import remarkParse from 'remark-parse'
import remarkRehype, { type Options as RemarkRehypeOptions } from 'remark-rehype'
import { unified, type PluggableList, type Processor } from 'unified'
import { visit } from 'unist-util-visit'

export interface MarkdownRecipe {
  // プラグインの組み合わせを表す鍵。同じ鍵には同じプラグイン列を渡すこと
  readonly key: string
  readonly remarkPlugins: PluggableList
  readonly rehypePlugins: PluggableList
  readonly remarkRehypeOptions: RemarkRehypeOptions
  readonly urlTransform: (url: string) => string
}

// 覚えておく木の数。一覧の 1 ページ (20) とノートのページ分けを見込む
const MAX_TREES = 120

type AnyProcessor = Processor<never, never, never, never, never>

const processors = new Map<string, AnyProcessor>()
const trees = new Map<string, Root>()

function processorOf(recipe: MarkdownRecipe): AnyProcessor {
  const known = processors.get(recipe.key)
  if (known !== undefined) {
    return known
  }
  const processor = unified()
    .use(remarkParse)
    .use(recipe.remarkPlugins)
    .use(remarkRehype, { ...recipe.remarkRehypeOptions, allowDangerousHtml: true })
    .use(recipe.rehypePlugins) as unknown as AnyProcessor
  processors.set(recipe.key, processor)
  return processor
}

// raw を text に、URL の属性を urlTransform に通す (react-markdown の post と同じ)
function finish(tree: Root, urlTransform: (url: string) => string): Root {
  visit(tree, (node, index, parent) => {
    if (node.type === 'raw' && parent && typeof index === 'number') {
      parent.children[index] = { type: 'text', value: node.value }
      return index
    }
    if (node.type === 'element') {
      for (const key in urlAttributes) {
        if (Object.hasOwn(urlAttributes, key) && Object.hasOwn(node.properties, key)) {
          const test = urlAttributes[key]
          if (test === null || test.includes(node.tagName)) {
            node.properties[key] = urlTransform(String(node.properties[key] || ''))
          }
        }
      }
    }
    return undefined
  })
  return tree
}

export function markdownTree(recipe: MarkdownRecipe, markdown: string): Root {
  const id = `${recipe.key}\u0000${markdown}`
  const known = trees.get(id)
  if (known !== undefined) {
    // 使った物を後ろへ (古い順に捨てるため)
    trees.delete(id)
    trees.set(id, known)
    return known
  }
  const processor = processorOf(recipe)
  const tree = finish(processor.runSync(processor.parse(markdown)) as unknown as Root, recipe.urlTransform)
  trees.set(id, tree)
  while (trees.size > MAX_TREES) {
    const oldest = trees.keys().next().value
    if (oldest === undefined) {
      break
    }
    trees.delete(oldest)
  }
  return tree
}

export function renderMarkdownTree(tree: Root, components: Components): ReactElement {
  return toJsxRuntime(tree, {
    Fragment,
    components,
    ignoreInvalidStyle: true,
    jsx,
    jsxs,
    passKeys: true,
    passNode: true,
  })
}

// テスト用。覚えた木を捨てる
export function clearMarkdownTrees(): void {
  trees.clear()
  processors.clear()
}
