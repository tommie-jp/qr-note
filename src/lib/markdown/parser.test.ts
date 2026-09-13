import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { describe, expect, test } from 'vitest'
import { createNoteParser } from './parser'
import { remarkAlerts } from './remarkAlerts'
import { remarkDetails, remarkDetailsSyntax } from './remarkDetails'

// 移行前の組み方。notePages.ts が呼ぶたびに組んでいた列で、描画側
// (react-markdown) にも同じ列が渡っていた (components/remarkPlugins.ts の
// BASE_REMARK_PLUGINS。parser.ts へ移して削除した)
const legacyParser = () =>
  unified()
    .use(remarkParse)
    .use([
      remarkGfm,
      remarkDetailsSyntax,
      remarkDetails,
      remarkBreaks,
      remarkMath,
      remarkAlerts,
    ])

// 解釈がずれやすい本文。表・数式・折りたたみ (micromark 拡張を持つもの) と、
// ページ分割・チェック・フェンス抽出が読むノード (水平線・listItem・code・定義)
const TRICKY_NOTES: Record<string, string> = {
  'リストの中のフェンス':
    '1. 手順\n\n    ```circuitikz\n    \\draw (0,0) to[R] (2,0);\n    ```\n2. つぎ\n',
  '折りたたみと知らない囲い':
    ':::details[まとめ]\n本文\n\n---\n\n:::\n\n:::foo\n**太字**\n:::\n\n型:int 12:30:45 ::note[x]\n',
  '閉じていない折りたたみ': ':::details\n中身\n\n- [ ] a\n',
  '数式': '$$\n\n---\n\n$$\n\nインライン $E=mc^2$ と `$x$`\n',
  '表の直後の区切り': '| a | b |\n| --- | --- |\n| 1 | 2 |\n---\nつぎ\n',
  'CRLF': '# 見出し\r\n\r\n- [ ] a\r\n- [x] b\r\n\r\n---\r\n本文\r\n1 行目\r\n2 行目\r\n',
  'タスクリスト':
    '- [ ] a\n  - [x] 入れ子\n1. [X] 番号付き\n\n> - [ ] 引用の中\n\n```\n- [ ] フェンスの中\n```\n',
  'アラート': '> [!NOTE]\n> 本文\n\n> [!FOO]\n> 知らない種類\n',
  '脚注と参照リンク':
    '本文[^1] と [リンク][x]\n\n[^1]: 注釈\n    続き\n\n[x]: https://example.com\n',
  'setext と表の罫線': '赤LED\n------\n\n----    ----\n\n***\n___\n',
  '閉じていないフェンス': '```matrix\n#電験三種\n',
}

describe('createNoteParser', () => {
  // 位置 (offset・line) も含めて比べる — notePages は区切りと定義の範囲を
  // position から切り出すので、木の形だけ同じでは足りない
  test.each(Object.entries(TRICKY_NOTES))(
    '移行前の組み方と同じ木を読む: %s',
    (_name, memo) => {
      // Arrange
      const parser = createNoteParser()

      // Act
      const tree = parser.parse(memo)

      // Assert
      expect(tree).toEqual(legacyParser().parse(memo))
    },
  )

  // 描画 (react-markdown) は parse の後に run まで通す。折りたたみ・改行・
  // アラートの変換 (transformer) まで含めて同じになることも見る
  test.each(Object.entries(TRICKY_NOTES))(
    '変換を通した後の木も移行前と同じ: %s',
    (_name, memo) => {
      // Arrange
      const parser = createNoteParser()
      const legacy = legacyParser()

      // Act
      const tree = parser.runSync(parser.parse(memo), memo)

      // Assert
      expect(tree).toEqual(legacy.runSync(legacy.parse(memo), memo))
    },
  )

  test('凍結済みのパーサを使い回しても前の本文を持ち越さない', () => {
    // Arrange
    const parser = createNoteParser()
    const memo = TRICKY_NOTES['折りたたみと知らない囲い']

    // Act
    const first = parser.parse(memo)
    parser.parse(TRICKY_NOTES['数式'])
    const again = parser.parse(memo)

    // Assert
    expect(again).toEqual(first)
  })
})
