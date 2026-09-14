import { describe, expect, test } from 'vitest'
import {
  buildMathSummaries,
  buildMathTexts,
  renderInlineMathHtml,
} from './mathText'

describe('renderInlineMathHtml', () => {
  test('インライン数式を KaTeX の HTML にする', () => {
    const html = renderInlineMathHtml('起電力 $E=100\\,\\mathrm{V}$ の電源')

    expect(html).not.toBeNull()
    expect(html).toContain('class="katex"')
    expect(html).toContain('起電力')
    expect(html).not.toContain('$E=')
  })

  test('地の文は HTML エスケープする (dangerouslySetInnerHTML に流すため)', () => {
    const html = renderInlineMathHtml('<b>強調</b> と $x$')

    expect(html).toContain('&lt;b&gt;強調&lt;/b&gt;')
    expect(html).not.toContain('<b>')
  })

  test('数式が無ければ null (表示側はプレーンテキストへ)', () => {
    expect(renderInlineMathHtml('数式のない本文')).toBeNull()
    expect(renderInlineMathHtml('')).toBeNull()
  })

  test('TeX の構文エラーでも例外にせず赤字ソース表示にする (ノート表示と同じ)', () => {
    const html = renderInlineMathHtml('壊れた式 $\\frac$ です')

    expect(html).not.toBeNull()
    expect(html).toContain('katex')
  })

  test('生成 HTML が大きすぎるときは null (プレーンテキストへ劣化)', () => {
    // KaTeX の HTML はソースの数倍〜十数倍。異常に長い数式で 1 項目が
    // ページを重くしないよう頭打ちにする
    const huge = `$${'x+'.repeat(4000)}x$`

    expect(renderInlineMathHtml(`式 ${huge}`)).toBeNull()
  })
})

describe('buildMathTexts', () => {
  const makeItem = (
    itemNo: string,
    memo: string,
    mode: 'memo' | 'url' = 'memo',
  ) => ({ itemNo, memo, mode })

  test('タイトルとプレビューの両方を数式つきで返す (mode=both)', () => {
    const map = buildMathTexts(
      [makeItem('1', '$S_2$ を開く\n定常状態では $I=E/R_1$ になる')],
      'both',
    )

    expect(map['1'].title).toContain('class="katex"')
    expect(map['1'].preview).toContain('class="katex"')
    // タイトルは 1 行目、プレビューは本文 (memoSummary / memoPreview と同じ割り方)
    expect(map['1'].title).toContain('を開く')
    expect(map['1'].preview).toContain('定常状態では')
  })

  test('数式がタイトルだけならプレビューの HTML は作らない', () => {
    const map = buildMathTexts([makeItem('1', '$x$ の話\nただの本文')], 'both')

    expect(map['1'].title).toContain('class="katex"')
    expect(map['1'].preview).toBeUndefined()
  })

  test('$ を含まないノートと URL モードはエントリを作らない', () => {
    const map = buildMathTexts(
      [makeItem('1', '数式なし\n本文'), makeItem('2', '$x$', 'url')],
      'both',
    )

    expect(map).toEqual({})
  })

  test('ブロック数式しか無いノートはエントリを作らない ($$ は一覧に出さない)', () => {
    const map = buildMathTexts([makeItem('1', 'タイトル\n$$\nE=mc^2\n$$')], 'both')

    expect(map).toEqual({})
  })
})

describe('buildMathTexts のモードと予算', () => {
  const makeItem = (
    itemNo: string,
    memo: string,
    mode: 'memo' | 'url' = 'memo',
  ) => ({ itemNo, memo, mode })

  test("mode='title' はプレビューを描かない (小/画像モードでは使われない)", () => {
    const map = buildMathTexts(
      [makeItem('1', '$S_2$ を開く\n定常状態では $I=E/R_1$ になる')],
      'title',
    )

    expect(map['1'].title).toContain('class="katex"')
    expect(map['1'].preview).toBeUndefined()
  })

  test('行を跨いだ $ の対は数式にしない (通貨の $ が 2 行にあるノート)', () => {
    const map = buildMathTexts(
      [makeItem('1', 'タイトル\n入力は $5 まで\n出力は $12 まで')],
      'both',
    )

    expect(map).toEqual({})
  })
})

describe('buildMathSummaries', () => {
  test('数式入りの要約だけを HTML にする', () => {
    const map = buildMathSummaries([
      { itemNo: '1', summary: '$E=100$ の回路' },
      { itemNo: '2', summary: '数式なし' },
    ])

    expect(map['1']).toContain('class="katex"')
    expect(map['2']).toBeUndefined()
  })

  test('buildMathTexts のタイトルがあれば描画を使い回す', () => {
    const titles = { '1': { title: '<span class="katex">再利用</span>' } }

    const map = buildMathSummaries(
      [{ itemNo: '1', summary: '$E=100$ の回路' }],
      titles,
    )

    expect(map['1']).toBe('<span class="katex">再利用</span>')
  })
})
