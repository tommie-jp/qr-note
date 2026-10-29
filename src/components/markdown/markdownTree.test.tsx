import { beforeEach, describe, expect, test } from 'vitest'
import type { Element, Root } from 'hast'
import { renderToStaticMarkup } from 'react-dom/server'
import { clearMarkdownTrees, markdownTree, renderMarkdownTree, type MarkdownRecipe } from './markdownTree'

// 解析の前段を本文ごとに覚える (docs/123 §11-4)。同じ本文・同じ鍵なら同じ木を
// 返すこと、react-markdown と同じ後処理 (raw は文字・URL は通す) を固定する

const RECIPE: MarkdownRecipe = {
  key: 'test',
  remarkPlugins: [],
  rehypePlugins: [],
  remarkRehypeOptions: {},
  urlTransform: (url) => (url.startsWith('javascript:') ? '' : url),
}

beforeEach(() => {
  clearMarkdownTrees()
})

function firstElement(tree: Root): Element {
  const element = tree.children.find((child) => child.type === 'element')
  if (element === undefined || element.type !== 'element') {
    throw new Error('要素が無い')
  }
  return element
}

describe('markdownTree', () => {
  test('同じ本文と鍵なら同じ木を返す (解析し直さない)', () => {
    // Act
    const a = markdownTree(RECIPE, '# 見出し')
    const b = markdownTree(RECIPE, '# 見出し')
    const other = markdownTree({ ...RECIPE, key: 'other' }, '# 見出し')

    // Assert
    expect(a).toBe(b)
    expect(other).not.toBe(a)
  })

  test('生の HTML は文字として残す', () => {
    // Act
    const html = renderToStaticMarkup(renderMarkdownTree(markdownTree(RECIPE, '<b>x</b>'), {}))

    // Assert
    expect(html).toContain('&lt;b&gt;')
    expect(html).not.toContain('<b>')
  })

  test('URL の属性は urlTransform を通す', () => {
    // Act
    const tree = markdownTree(RECIPE, '[a](javascript:alert(1)) [b](https://example.com)')

    // Assert
    const paragraph = firstElement(tree)
    const links = paragraph.children.filter((c): c is Element => c.type === 'element' && c.tagName === 'a')
    expect(links.map((a) => a.properties.href)).toEqual(['', 'https://example.com'])
  })

  test('部品で要素を差し替えて描ける', () => {
    // Act
    const html = renderToStaticMarkup(
      renderMarkdownTree(markdownTree(RECIPE, '本文'), { p: ({ children }) => <section>{children}</section> }),
    )

    // Assert
    expect(html).toBe('<section>本文</section>')
  })
})
