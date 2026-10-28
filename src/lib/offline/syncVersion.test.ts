import { describe, expect, test, vi } from 'vitest'

// 純関数だけを見る。同じ module が prisma を掴むので差し替える
vi.mock('@/lib/db', () => ({ prisma: {} }))

const { formatSyncEtag } = await import('./syncVersion')

const ROW = {
  live: 1513,
  updated: new Date('2026-10-29T00:00:00.000Z'),
  accessed: new Date('2026-10-29T00:05:00.000Z'),
  deleted: new Date('2026-10-01T00:00:00.000Z'),
  pinned: 3,
  svgs: 490,
}

describe('formatSyncEtag', () => {
  test('件数・最終更新・最終アクセス・最終削除・印の数・描画済み回路図の数を 1 つに畳む', () => {
    expect(formatSyncEtag(ROW)).toBe(
      '"1513-1793232000000-1793232300000-1790812800000-3-490"',
    )
  })

  test('ノートが 1 件も無ければ日時は 0', () => {
    expect(formatSyncEtag({ ...ROW, live: 0, updated: null, accessed: null, deleted: null })).toBe(
      '"0-0-0-0-3-490"',
    )
  })

  test.each([
    ['ノートの追加・編集', { ...ROW, updated: new Date('2026-10-29T00:00:01.000Z') }],
    ['ノートを開いた (並びに効く)', { ...ROW, accessed: new Date('2026-10-29T00:06:00.000Z') }],
    ['ゴミ箱へ入れた (updated_at は動かない)', { ...ROW, live: 1512, deleted: new Date('2026-10-29T00:07:00.000Z') }],
    ['印を付けた (updated_at は動かない)', { ...ROW, pinned: 4 }],
    ['回路図が描かれた', { ...ROW, svgs: 491 }],
  ])('%s で値が変わる', (_label, changed) => {
    expect(formatSyncEtag(changed)).not.toBe(formatSyncEtag(ROW))
  })
})
