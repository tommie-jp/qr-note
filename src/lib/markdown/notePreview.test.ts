import { describe, expect, test } from 'vitest'
import {
  NOTE_PREVIEW_COMPACT_SOURCE_CHARS,
  NOTE_PREVIEW_MAX_FENCE_LINES,
  NOTE_PREVIEW_MAX_LINES,
  NOTE_PREVIEW_MAX_SOURCE_CHARS,
  notePreviewSource,
  wantsNotePreview,
} from './notePreview'

const IMAGE = '0421547b-ee29-4613-a6d4-da0f41f94054.jpg'

describe('notePreviewSource', () => {
  test('短い本文はそのまま返す', () => {
    const memo = 'タイトル\n#tag\n本文の説明'
    expect(notePreviewSource(memo)).toBe(memo)
  })

  test('文字数の上限で切り詰める', () => {
    const memo = Array.from({ length: 100 }, (_, i) => `行${i} の説明文です`).join('\n')
    const result = notePreviewSource(memo)
    expect(result.length).toBeLessThanOrEqual(NOTE_PREVIEW_MAX_SOURCE_CHARS + 8)
    expect(result).toContain('行0 の説明文です')
  })

  test('行数の上限で切り詰める', () => {
    const memo = Array.from({ length: 100 }, (_, i) => `${i}`).join('\n')
    const result = notePreviewSource(memo)
    expect(result.split('\n').length).toBeLessThanOrEqual(NOTE_PREVIEW_MAX_LINES)
  })

  test('先頭の 1 行が長大でも空にせず行の途中で切る', () => {
    // OCR やコピペで改行なしの長文が先頭に来るノートの受け皿
    const memo = 'あ'.repeat(5000)
    const result = notePreviewSource(memo)
    expect(result.length).toBe(NOTE_PREVIEW_MAX_SOURCE_CHARS)
    expect(result.startsWith('あああ')).toBe(true)
  })

  test('行の途中で切るときサロゲートペアを壊さない', () => {
    // 絵文字 (2 code unit) を境界に置く。壊れると置換文字が描画される
    const memo = 'a'.repeat(NOTE_PREVIEW_MAX_SOURCE_CHARS - 1) + '😀のこり'
    const result = notePreviewSource(memo)
    expect(result.endsWith('\uD83D')).toBe(false)
  })

  test('コードフェンスの途中で切れたら閉じ行を補う', () => {
    // 閉じないままだと打ち切った尻尾まで「フェンスの続き」に見える
    const body = Array.from({ length: 50 }, (_, i) => `code line ${i} ${'x'.repeat(20)}`)
    const memo = 'タイトル\n```bash\n' + body.join('\n')
    const result = notePreviewSource(memo)
    const fences = result.split('\n').filter((l) => l.startsWith('```'))
    expect(fences.length).toBe(2)
    expect(result.endsWith('```')).toBe(true)
  })

  test('コードフェンスの本体は上限行数だけ残す', () => {
    const body = Array.from({ length: 30 }, (_, i) => `l${i}`)
    const memo = '```text\n' + body.join('\n') + '\n```\nあとがき'
    const result = notePreviewSource(memo)
    expect(result).toContain(`l${NOTE_PREVIEW_MAX_FENCE_LINES - 1}`)
    expect(result).not.toContain(`l${NOTE_PREVIEW_MAX_FENCE_LINES}`)
    // 間引いても閉じ行と後続の本文は残る
    expect(result).toContain('あとがき')
  })

  test('小表示はさらに短く切る (40px では模様にしかならない)', () => {
    const memo = Array.from({ length: 100 }, (_, i) => `行${i} の説明`).join('\n')
    const result = notePreviewSource(memo, NOTE_PREVIEW_COMPACT_SOURCE_CHARS)
    expect(result.length).toBeLessThanOrEqual(NOTE_PREVIEW_COMPACT_SOURCE_CHARS)
    expect(result).toContain('行0 の説明')
  })

  test('別種の区切り (``` の中の ~~~) ではフェンスを閉じない', () => {
    // 閉じたことにすると、開きっぱなしの ``` に閉じが補われず、
    // プレビュー全体が 1 つのコードブロックに化ける
    const body = Array.from({ length: 40 }, (_, i) => `l${i} ${'x'.repeat(30)}`)
    const memo = '```text\n~~~\n' + body.join('\n')
    const result = notePreviewSource(memo)
    expect(result.endsWith('```')).toBe(true)
    // 開き (```text) と補った閉じ (```) の 2 本。~~~ は中身のまま残る
    expect(result.split('\n').filter((l) => l.startsWith('```')).length).toBe(2)
    expect(result).toContain('~~~')
  })

  test('切り詰めが $$ の対を割らない', () => {
    // 半端な $$ が残ると、後続の地の文まで数式として描かれる
    const memo = 'あ'.repeat(NOTE_PREVIEW_MAX_SOURCE_CHARS - 10) + ' $$E=mc^2$$ 続き'
    const result = notePreviewSource(memo)
    expect(result.split('$$').length % 2).toBe(1)
  })

  test('区切り行が予算で切れても状態を進めない (閉じを補える)', () => {
    // 途中で切れた閉じ行が「閉じた」と数えられると、補いが働かない
    const memo = '$$\n' + 'x'.repeat(NOTE_PREVIEW_MAX_SOURCE_CHARS - 5) + '\n$$\nあとがき'
    const result = notePreviewSource(memo)
    const marks = result.split('\n').filter((l) => l.trim() === '$$')
    expect(marks.length).toBe(2)
  })

  test('ブロック数式の途中で切れたら $$ を補う', () => {
    const lines = Array.from({ length: 60 }, (_, i) => `x_{${i}} + y_{${i}} \\\\`)
    const memo = '数式ノート\n$$\n' + lines.join('\n')
    const result = notePreviewSource(memo)
    // 開きと補った閉じで $$ の行が偶数になる
    const marks = result.split('\n').filter((l) => l.trim() === '$$')
    expect(marks.length).toBe(2)
  })

  test('数式ブロックの中の ``` はフェンスとして数えない', () => {
    // hiddenLineSkipper と同じ近似 (TeX の一部として扱う)
    const memo = '$$\na = 1\n```\nb = 2\n$$\nあとがき'
    const result = notePreviewSource(memo)
    expect(result).toBe(memo)
  })

  test('閉じたフェンス・数式には何も足さない', () => {
    const memo = '```bash\nls\n```\n\n$$\nE = mc^2\n$$'
    expect(notePreviewSource(memo)).toBe(memo)
  })
})

describe('wantsNotePreview', () => {
  test('本文だけのノートは対象', () => {
    expect(wantsNotePreview({ mode: 'memo', memo: '抵抗の説明' })).toBe(true)
  })

  test('URL モードは対象外', () => {
    expect(wantsNotePreview({ mode: 'url', memo: '' })).toBe(false)
  })

  test('空のノートは対象外 (「(空のノート)」の受け皿を保つ)', () => {
    expect(wantsNotePreview({ mode: 'memo', memo: '  \n ' })).toBe(false)
  })

  test('画像サムネを持つノートは対象外 (優先順位 1 が受ける)', () => {
    expect(
      wantsNotePreview({ mode: 'memo', memo: `写真\n![](/api/images/${IMAGE})` }),
    ).toBe(false)
  })
})
