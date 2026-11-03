import { describe, expect, test, vi } from 'vitest'
import type { Item } from '@/generated/prisma/client'
import { activeResultView, carryResultViewParams, noteTabsFor } from './registry'

// next/dynamic の部品は描かないので、読み込みだけ止める
vi.mock('next/dynamic', () => ({ default: () => () => null }))

const params = (search: string) => new URLSearchParams(search)

const item = (props: unknown): Item => ({
  itemId: 'id1',
  memo: '# 歯医者\ndate=2026-11-05\n',
  title: '歯医者',
  tags: [],
  props: props as Item['props'],
  taskTodo: 0,
  taskDone: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  accessedAt: new Date(),
  deletedAt: null,
  publicAt: null,
  offlinePin: false,
  eventStart: null,
  eventEnd: null,
  eventRepeat: null,
})

const ctx = { itemId: 'id1', tab: null, date: null, query: '', fullscreen: false }

describe('検索結果の表示', () => {
  test('cal= があればカレンダー、無ければ一覧 (null)', () => {
    expect(activeResultView(params('q=a&cal=2026-11'))?.id).toBe('calendar')
    expect(activeResultView(params('q=a'))).toBeNull()
  })

  test('検索語を打ち替えた URL に cal を持ち越す', () => {
    expect(carryResultViewParams('/?q=b', params('q=a&cal=2026-11'))).toBe('/?q=b&cal=2026-11')
    expect(carryResultViewParams('/?q=b', params('q=a'))).toBe('/?q=b')
  })
})

describe('ノートのタブ', () => {
  test('date= を持つノートには「予定」タブ', () => {
    const tabs = noteTabsFor({ ...ctx, item: item([{ key: 'date', label: 'date', value: '2026-11-05' }]) })
    expect(tabs.map((t) => [t.key, t.label])).toEqual([['event', '予定']])
  })

  test('予定でないノートには出さない', () => {
    expect(noteTabsFor({ ...ctx, item: item([]) })).toEqual([])
    expect(noteTabsFor({ ...ctx, item: null })).toEqual([])
  })

  test('URL が求めれば未登録のノートにも出す (新しい予定)', () => {
    expect(noteTabsFor({ ...ctx, item: null, tab: 'event', date: '2026-11-05' })).toHaveLength(1)
  })
})
