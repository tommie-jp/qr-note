import type { Code, Root } from 'mdast'
import { visit } from 'unist-util-visit'
import { describe, expect, test } from 'vitest'
import { extractFenceSources, extractFences, uniqueBy } from './extractFences'
import { createNoteParser } from './parser'

describe('extractFences', () => {
  const isAorB = (lang: string | null | undefined): lang is 'a' | 'b' =>
    lang === 'a' || lang === 'b'

  test('対象の言語を本文の順に、重複も空もそのまま返す', () => {
    // Arrange
    const markdown = ['```b', ' B ', '```', '```a', '```', '```b', 'B', '```'].join(
      '\n',
    )

    // Act
    const fences = extractFences(markdown, isAorB)

    // Assert
    expect(fences).toEqual([
      { lang: 'b', source: 'B' },
      { lang: 'a', source: '' },
      { lang: 'b', source: 'B' },
    ])
  })

  test('言語の無いフェンスや他の言語は拾わない', () => {
    const markdown = ['```', 'a', '```', '```text', 'a', '```'].join('\n')
    expect(extractFences(markdown, isAorB)).toEqual([])
  })

  test('~~~ のフェンスもリストの中のフェンスも拾う', () => {
    const markdown = ['~~~a', 'X', '~~~', '', '- 項目', '', '  ```b', '  Y', '  ```'].join(
      '\n',
    )
    expect(extractFences(markdown, isAorB)).toEqual([
      { lang: 'a', source: 'X' },
      { lang: 'b', source: 'Y' },
    ])
  })
})

describe('extractFenceSources', () => {
  test('指定した言語の中身を trim して重複なしで返す', () => {
    // Arrange
    const markdown = ['```matrix', '#a', '```', '```matrix', '#b', '```', '```matrix', '#a  ', '```'].join(
      '\n',
    )

    // Act
    const sources = extractFenceSources(markdown, 'matrix')

    // Assert
    expect(sources).toEqual(['#a', '#b'])
  })

  test('中身が空のフェンスも捨てない (鍵は空文字)', () => {
    expect(extractFenceSources('```health\n```\n\n```health\n\n```', 'health')).toEqual([''])
  })

  test('入れ子のフェンスの中は拾わない', () => {
    const markdown = ['````markdown', '```matrix', '#a', '```', '````'].join('\n')
    expect(extractFenceSources(markdown, 'matrix')).toEqual([])
  })
})

describe('uniqueBy', () => {
  test('鍵が同じものは最初の 1 つだけ残し、順を保つ', () => {
    const items = [
      { id: 'x', n: 1 },
      { id: 'y', n: 2 },
      { id: 'x', n: 3 },
    ]
    expect(uniqueBy(items, (item) => item.id)).toEqual([
      { id: 'x', n: 1 },
      { id: 'y', n: 2 },
    ])
  })

  test('元の配列は変えない', () => {
    const items = ['a', 'a']
    uniqueBy(items, (item) => item)
    expect(items).toEqual(['a', 'a'])
  })
})

// 本文の解釈は描画側 (lib/markdown/parser.ts の createNoteParser) と同じ列で
// 行う。素の remark-parse で読むと、描画では数式になるフェンスを図として
// 拾い、描画では図になる脚注の中のフェンスを見落としていた
describe('描画と同じ解釈で拾う', () => {
  const isCircuit = (lang: string | null | undefined): lang is 'circuit' =>
    lang === 'circuit'

  test('数式ブロック ($$) の中のフェンスは拾わない', () => {
    const markdown = [
      '$$',
      '```circuit',
      'parts:',
      '  R1: r a b',
      '```',
      '$$',
      '',
      '```circuit',
      'parts:',
      '  R2: r a b',
      '```',
    ].join('\n')

    expect(extractFences(markdown, isCircuit)).toEqual([
      { lang: 'circuit', source: 'parts:\n  R2: r a b' },
    ])
  })

  test('脚注の中に字下げして置いたフェンスも拾う', () => {
    const markdown = [
      '本文[^1]',
      '',
      '[^1]: 注',
      '    ```circuit',
      '    parts:',
      '      R3: r a b',
      '    ```',
    ].join('\n')

    expect(extractFences(markdown, isCircuit)).toEqual([
      { lang: 'circuit', source: 'parts:\n  R3: r a b' },
    ])
  })

  test('折りたたみ (:::details) の中のフェンスは閉じ忘れても拾う', () => {
    const markdown = [':::details 見出し', '```circuit', 'parts:', '  R4: r a b', '```'].join(
      '\n',
    )

    expect(extractFences(markdown, isCircuit)).toEqual([
      { lang: 'circuit', source: 'parts:\n  R4: r a b' },
    ])
  })
})

// 抽出用の parser (remark-gfm なし) が、描画の parser と同じ所でフェンスを
// 見つけること (docs/122 §2)。全ノートでの一致は scripts/checkFenceParsers.ts
describe('抽出用の parser と描画の parser の一致', () => {
  const F = '```'
  const noteFences = (markdown: string): string[] => {
    const out: string[] = []
    visit(createNoteParser().parse(markdown) as Root, 'code', (node: Code) => {
      out.push(`${node.lang}:${node.value.trim()}`)
    })
    return out
  }
  const any = (lang: string | null | undefined): lang is string => typeof lang === 'string'
  const fenceFences = (markdown: string) =>
    extractFences(markdown, any).map((f) => `${f.lang}:${f.source}`)

  test.each([
    ['表のセルの中のフェンス記号 (インラインのコード)', ['| a | b |', '| --- | --- |', `| ${F}circuit x${F} | 2 |`].join('\n')],
    ['表の直後のフェンス (空行なし)', ['| a |', '| --- |', '| 1 |', `${F}circuit`, 'x', F].join('\n')],
    ['脚注の定義の中のフェンス', ['本文[^1]', '', '[^1]: 注', '', `    ${F}circuit`, '    x', `    ${F}`].join('\n')],
    [':::details の中のフェンス', [':::details 開く', `${F}circuit`, 'x', F, ':::'].join('\n')],
    ['$$ の中のフェンス記号 (数式の中身)', ['$$', F, 'x', F, '$$'].join('\n')],
    ['リストの中のフェンス', ['- 項目', '', `  ${F}circuit`, '  x', `  ${F}`].join('\n')],
  ])('%s', (_label, markdown) => {
    expect(fenceFences(markdown)).toEqual(noteFences(markdown))
  })

  test('$$ の中の記号はフェンスにしない (math を外さない理由)', () => {
    expect(fenceFences(['$$', `${F}circuit`, 'x', F, '$$'].join('\n'))).toEqual([])
  })
})
