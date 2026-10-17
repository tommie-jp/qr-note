import { describe, expect, test } from 'vitest'

import type { OfflineItem } from './item'
import { buildOfflineIndex, filterOfflineItems } from './filter'

function item(over: Partial<OfflineItem> = {}): OfflineItem {
  return {
    itemId: '4518',
    memo: '',
    url: '',
    mode: 'memo',
    title: '',
    tags: [],
    taskTodo: 0,
    taskDone: 0,
    updatedAt: '2026-08-01T00:00:00.000Z',
    accessedAt: '2026-08-01T00:00:00.000Z',
    pinned: false,
    ...over,
  }
}

// 検索して当たった itemId を並び順そのままで返す (絞り込みだけを見る)
function hits(items: OfflineItem[], query: string): string[] {
  return filterOfflineItems(buildOfflineIndex(items), query).map((i) => i.itemId)
}

describe('filterOfflineItems', () => {
  test('絞り込みが無ければ全件を元の順のまま返す', () => {
    // Arrange
    const items = [item({ itemId: '1' }), item({ itemId: '2' })]

    // Act / Assert
    expect(hits(items, '')).toEqual(['1', '2'])
    expect(hits(items, '   ')).toEqual(['1', '2'])
  })

  test('語は memo の部分一致で当たる', () => {
    const items = [
      item({ itemId: '1', memo: '2SC1815 トランジスタ' }),
      item({ itemId: '2', memo: '1608 チップ抵抗' }),
    ]
    expect(hits(items, 'トランジスタ')).toEqual(['1'])
    // PGroonga のバイグラムと違い部分文字列で見るので、語の途中でも当たる
    expect(hits(items, 'ランジ')).toEqual(['1'])
  })

  test('語は url も見る', () => {
    const items = [
      item({ itemId: '1', mode: 'url', url: 'https://akizukidenshi.com/g/g12345' }),
      item({ itemId: '2', memo: 'メモだけ' }),
    ]
    expect(hits(items, 'akizuki')).toEqual(['1'])
  })

  // サーバ (items/where.ts の termCondition) は memo / url しか見ない。id の
  // 前方一致を残すと、UUID の頭の数字を打ったときだけ圏外で余計に当たり、
  // オンラインとオフラインで結果が割れる (docs/107 §4-5)
  test('語は id には当たらない (サーバと同じく memo / url だけを見る)', () => {
    const items = [item({ itemId: '0199f3a0-0000-7000-8000-000000004518' })]
    expect(hits(items, '0199')).toEqual([])
  })

  // 旧番号は本文のタグ #4518 になった。全文検索でもタグ検索でも当たる
  test('旧番号は本文のタグとして当たる', () => {
    const items = [
      item({ itemId: 'a', memo: '2SC1815 #4518', tags: ['4518'] }),
      item({ itemId: 'b', memo: '1451 の抵抗' }),
    ]
    expect(hits(items, '4518')).toEqual(['a'])
    expect(hits(items, '#4518')).toEqual(['a'])
  })

  test('全角・大小は同一視する (PGroonga の NormalizerAuto と揃える)', () => {
    const items = [item({ itemId: '1', memo: '2SC1815 NPN' })]
    expect(hits(items, 'npn')).toEqual(['1'])
    expect(hits(items, 'ＮＰＮ')).toEqual(['1'])
    expect(hits(items, '２ｓｃ')).toEqual(['1'])
  })

  test('空白の並置は AND', () => {
    const items = [
      item({ itemId: '1', memo: '抵抗 1608' }),
      item({ itemId: '2', memo: '抵抗 3216' }),
    ]
    expect(hits(items, '抵抗 1608')).toEqual(['1'])
  })

  test('OR と括弧と NOT が効く', () => {
    const items = [
      item({ itemId: '1', memo: '抵抗' }),
      item({ itemId: '2', memo: 'コンデンサ' }),
      item({ itemId: '3', memo: 'コイル' }),
    ]
    expect(hits(items, '抵抗 OR コンデンサ')).toEqual(['1', '2'])
    expect(hits(items, '!抵抗')).toEqual(['2', '3'])
    expect(hits(items, '!(抵抗 OR コイル)')).toEqual(['2'])
  })

  test('#タグ はタグの完全一致 (部分一致しない)', () => {
    const items = [
      item({ itemId: '1', tags: ['npn'], memo: '#npn' }),
      item({ itemId: '2', tags: ['npn-old'], memo: '#npn-old' }),
    ]
    expect(hits(items, '#npn')).toEqual(['1'])
  })

  test('タグ名の全角・大小はタグ側も検索語側も正規化して比べる', () => {
    const items = [item({ itemId: '1', tags: ['npn'] })]
    expect(hits(items, '#ＮＰＮ')).toEqual(['1'])
  })

  // タグは本文にも `#npn` と書かれているので、全文検索に落ちると素通ししてしまう。
  // タグ語がタグ検索として評価されていることを、本文に書いていない例で確かめる
  test('タグ語は本文の部分一致には落ちない', () => {
    const items = [item({ itemId: '1', memo: 'npn とだけ書いたノート', tags: [] })]
    expect(hits(items, '#npn')).toEqual([])
  })

  test('is:todo / is:done はチェックの個数で絞る', () => {
    const items = [
      item({ itemId: '1', taskTodo: 2, taskDone: 0 }),
      item({ itemId: '2', taskTodo: 0, taskDone: 3 }),
      item({ itemId: '3', taskTodo: 1, taskDone: 1 }),
    ]
    expect(hits(items, 'is:todo')).toEqual(['1', '3'])
    expect(hits(items, 'is:done')).toEqual(['2', '3'])
    expect(hits(items, 'is:todo !is:done')).toEqual(['1'])
  })

  test('is:untagged はタグの無いノートだけに絞る (docs/86 §5)', () => {
    const items = [
      item({ itemId: '1', tags: [] }),
      item({ itemId: '2', tags: ['npn'] }),
    ]
    expect(hits(items, 'is:untagged')).toEqual(['1'])
    expect(hits(items, '!is:untagged')).toEqual(['2'])
  })

  test('引用した語は演算子ではなくただの語になる', () => {
    const items = [
      item({ itemId: '1', memo: 'A or B' }),
      item({ itemId: '2', memo: 'A' }),
    ]
    expect(hits(items, '"or"')).toEqual(['1'])
  })

  test('タグ検索とテキスト検索を混ぜられる', () => {
    const items = [
      item({ itemId: '1', memo: '2SC1815', tags: ['bjt'] }),
      item({ itemId: '2', memo: '2SA1015', tags: ['bjt'] }),
    ]
    expect(hits(items, '#bjt 2SC')).toEqual(['1'])
  })
})

describe('buildOfflineIndex', () => {
  // 打鍵のたびに全件を NFKC で畳み直すと、数百件でも体感に出る。
  // 正規化済みの文字列を 1 度だけ作っておくのがこの関数の役目
  test('正規化済みの検索対象を 1 件ずつ持つ', () => {
    const index = buildOfflineIndex([item({ itemId: '4518', memo: 'ＮＰＮ', url: 'HTTP://X' })])
    expect(index[0].haystack).toContain('npn')
    expect(index[0].haystack).toContain('http://x')
  })
})
