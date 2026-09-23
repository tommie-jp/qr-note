import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { fenceAtCursor } from './fenceAtCursor'

// 「図を編集」(docs/99) が押せるかと、押したときにどのフェンスを殻へ渡すか。
// 範囲は構文木が決め、言語は上流 (fence-kit の extractFences) と同じ規則で読む

const DOC = [
  '# 見出し', //          0
  '', //                  1
  '```breadboard', //     2
  'board: half', //       3
  'parts:', //            4
  '  R1: resistor a5 a10 330', // 5
  '```', //               6
  '', //                  7
  'あとがき。', //        8
].join('\n')

function stateAt(doc: string, anchor: number): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor },
    extensions: [markdown({ base: markdownLanguage })],
  })
}

// 行 (0 始まり) の頭から column 字目の位置
function pos(doc: string, line: number, column = 0): number {
  const lines = doc.split('\n')
  return lines.slice(0, line).reduce((sum, text) => sum + text.length + 1, 0) + column
}

describe('fenceAtCursor', () => {
  test('本文の行の途中なら、そのフェンスの言語と本文 1 行目を返す', () => {
    // Arrange
    const state = stateAt(DOC, pos(DOC, 5, 8))

    // Act
    const hit = fenceAtCursor(state)

    // Assert — 本文 1 行目は 0 始まりの 3 行目 (殻の fenceLine にそのまま渡す)
    expect(hit).toEqual({ lang: 'breadboard', bodyLine: 3 })
  })

  test('開きの行の頭でも拾う (前の段落に付かない)', () => {
    expect(fenceAtCursor(stateAt(DOC, pos(DOC, 2)))?.lang).toBe('breadboard')
  })

  test('閉じの行の末尾でも拾う (ウィジェットの「触れている」と同じ)', () => {
    expect(fenceAtCursor(stateAt(DOC, pos(DOC, 6, 3)))?.lang).toBe('breadboard')
  })

  test('フェンスの外なら null', () => {
    expect(fenceAtCursor(stateAt(DOC, pos(DOC, 0, 2)))).toBeNull()
    expect(fenceAtCursor(stateAt(DOC, pos(DOC, 8, 2)))).toBeNull()
  })

  test('閉じの次の空行は外', () => {
    expect(fenceAtCursor(stateAt(DOC, pos(DOC, 7)))).toBeNull()
  })

  test('閉じていないフェンスは本文の末尾まで中', () => {
    const doc = '```perfboard\nboard: 16x8\nparts:'
    expect(fenceAtCursor(stateAt(doc, doc.length))).toEqual({
      lang: 'perfboard',
      bodyLine: 1,
    })
  })

  test('~~~ のフェンスも同じ', () => {
    const doc = '~~~perfboard\nboard: 16x8\n~~~'
    expect(fenceAtCursor(stateAt(doc, pos(doc, 1, 3)))?.lang).toBe('perfboard')
  })

  test('言語は情報文字列の先頭の語だけ', () => {
    const doc = '```breadboard title=LED\nboard: half\n```'
    expect(fenceAtCursor(stateAt(doc, pos(doc, 1)))?.lang).toBe('breadboard')
  })

  test('他の言語のフェンスでも言語を返す (押せるかは呼ぶ側が決める)', () => {
    const doc = '```quiz\n問: 1+1\n```'
    expect(fenceAtCursor(stateAt(doc, pos(doc, 1)))?.lang).toBe('quiz')
  })

  // 上流の殻は開きの行を「行頭から字下げ 3 つまで」でしか拾わない。
  // ここで拾ってしまうと、押せるのに殻が「フェンスを見失いました」と言う
  test('引用の中のフェンスは言語なし (殻が拾えない)', () => {
    const doc = '> ```breadboard\n> board: half\n> ```'
    expect(fenceAtCursor(stateAt(doc, pos(doc, 1, 4)))?.lang).toBe('')
  })

  test('大文字の言語はそのまま返す (殻は綴りを完全一致で見る)', () => {
    const doc = '```Breadboard\nboard: half\n```'
    expect(fenceAtCursor(stateAt(doc, pos(doc, 1)))?.lang).toBe('Breadboard')
  })
})
