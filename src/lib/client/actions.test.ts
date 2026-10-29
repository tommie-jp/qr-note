import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { setUnauthorizedHandler } from './api'
import { searchSortStore } from './searchPrefs'

// 端末側の action (docs/123 §2-1)。Server Action と同じ形で部品から呼ばれ、
// 中身は JSON API。送る本文・書いた後の控えの扱い・画面の動かし方を固定する
const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  refresh: vi.fn(),
  noteWritten: vi.fn(),
  notesWritten: vi.fn(),
  allNotesWritten: vi.fn(),
  switchView: vi.fn(async () => {}),
  switchPane: vi.fn(async () => {}),
}))

vi.mock('./navigation', () => ({
  navigate: mocks.navigate,
  refreshServerView: mocks.refresh,
}))
vi.mock('./invalidate', () => ({
  noteWritten: mocks.noteWritten,
  notesWritten: mocks.notesWritten,
  allNotesWritten: mocks.allNotesWritten,
}))
vi.mock('@/components/search/switchViewMode', () => ({ switchViewMode: mocks.switchView }))
vi.mock('@/components/panes/switchPaneMode', () => ({ switchPaneMode: mocks.switchPane }))

const actions = await import('./actions')

const ID = '019a0000-0000-7000-8000-000000000001'
const DTO = {
  itemId: ID,
  memo: 'm',
  title: 't',
  tags: [],
  props: [],
  taskTodo: 0,
  taskDone: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  accessedAt: '2026-10-01T00:00:00.000Z',
  deletedAt: null,
  publicAt: null,
  offlinePin: false,
}

type Call = { url: string; method: string; body: unknown }
let calls: Call[] = []
let reply: { status: number; body: unknown } = { status: 200, body: {} }

function form(entries: Array<[string, string]>): FormData {
  const data = new FormData()
  for (const [key, value] of entries) {
    data.append(key, value)
  }
  return data
}

beforeEach(() => {
  calls = []
  reply = { status: 200, body: { success: true, data: { item: DTO }, error: null } }
  vi.clearAllMocks()
  setUnauthorizedHandler(() => {})
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({
        url,
        method: init.method ?? 'GET',
        body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      })
      return new Response(JSON.stringify(reply.body), { status: reply.status })
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('本文の保存', () => {
  test('版を添えて PUT し、控えを差し替えて保存済みの印へ移る', async () => {
    // Act
    const state = await actions.updateMemoAction(
      null,
      form([
        ['itemId', ID],
        ['memo', '新しい本文'],
        ['base', '1700000000000'],
      ]),
    )

    // Assert
    expect(state).toBeNull()
    expect(calls).toEqual([
      {
        url: `/api/items/${ID}`,
        method: 'PUT',
        body: { memo: '新しい本文', base: '1700000000000', checkpoint: false },
      },
    ])
    expect(mocks.noteWritten).toHaveBeenCalledWith(ID, DTO)
    expect(mocks.navigate).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^/item/${ID}\\?saved=\\d+$`)))
  })

  test('競合 (409) は書かずに戻り値で返し、画面は動かさない', async () => {
    // Arrange
    const conflict = { kind: 'conflict', seq: 1, server: { memo: 'x', updatedAt: 2, deletedAt: null } }
    reply = { status: 409, body: { success: false, data: { state: conflict }, error: '競合' } }

    // Act
    const state = await actions.updateItemAction(
      null,
      form([
        ['itemId', ID],
        ['memo', 'm'],
        ['base', '1'],
        ['checkpoint', '1'],
      ]),
    )

    // Assert
    expect(state).toEqual(conflict)
    expect(calls[0].body).toMatchObject({ checkpoint: true })
    expect(mocks.navigate).not.toHaveBeenCalled()
    // 控えは古い印だけ付ける (いまの版を取り直す)
    expect(mocks.noteWritten).toHaveBeenCalledWith(ID)
  })

  test('それ以外の失敗は文言付きで投げる', async () => {
    // Arrange
    reply = { status: 400, body: { success: false, data: null, error: 'リクエストの形式が正しくありません' } }

    // Act / Assert
    await expect(
      actions.updateMemoAction(null, form([['itemId', ID], ['memo', ''], ['base', 'x']])),
    ).rejects.toThrow('リクエストの形式が正しくありません')
  })
})

describe('ノート 1 件の操作', () => {
  test('チェックは望む状態を PATCH で送る', async () => {
    // Act
    await actions.toggleMemoTaskAction(ID, 3, true)

    // Assert
    expect(calls[0]).toEqual({ url: `/api/items/${ID}/tasks`, method: 'PATCH', body: { line: 3, checked: true } })
    expect(mocks.noteWritten).toHaveBeenCalledWith(ID, DTO)
  })

  test('健康記録は値をそのまま POST で送る', async () => {
    // Act
    await actions.recordHealthAction(ID, '2026-10-29', '体重', [60.5], 'kg')

    // Assert
    expect(calls[0]).toEqual({
      url: `/api/items/${ID}/health`,
      method: 'POST',
      body: { date: '2026-10-29', item: '体重', values: [60.5], unit: 'kg' },
    })
  })

  test('公開は form の public=1 を真偽にして送る', async () => {
    // Act
    await actions.setItemPublicAction(form([['itemId', ID], ['public', '1']]))

    // Assert
    expect(calls[0]).toEqual({ url: `/api/items/${ID}/public`, method: 'PUT', body: { isPublic: true } })
  })

  test('開いた記録は失敗しても投げず、401 でも画面を読み直さない', async () => {
    // Arrange
    const reloads = vi.fn()
    setUnauthorizedHandler(reloads)
    reply = { status: 401, body: { success: false, data: null, error: 'ログインが必要です' } }

    // Act
    await actions.recordAccessAction(ID)

    // Assert
    expect(calls[0]).toMatchObject({ url: `/api/items/${ID}/access`, method: 'POST' })
    expect(reloads).not.toHaveBeenCalled()
  })
})

describe('まとめての操作', () => {
  test('一括タグの「外す」は removeTag を優先する', async () => {
    // Act
    await actions.bulkTagAction(
      form([
        ['itemId', ID],
        ['itemId', `${ID.slice(0, -1)}2`],
        ['removeTag', '部品'],
        ['addTags', '無視される'],
      ]),
    )

    // Assert
    expect(calls[0]).toEqual({
      url: '/api/items/tags',
      method: 'POST',
      body: { mode: 'remove', itemIds: [ID, `${ID.slice(0, -1)}2`], tags: '部品' },
    })
    expect(mocks.notesWritten).toHaveBeenCalledWith([ID, `${ID.slice(0, -1)}2`])
  })

  test('ゴミ箱の操作は op を付けて送り、サーバ描画の画面を描き直させる', async () => {
    // Act
    await actions.trashItemsAction(form([['itemId', ID]]))
    await actions.emptyTrashAction()

    // Assert
    expect(calls.map((c) => c.body)).toEqual([
      { op: 'trash', itemIds: [ID] },
      { op: 'empty', itemIds: [] },
    ])
    expect(mocks.refresh).toHaveBeenCalledTimes(2)
    // 空にしたノートの id は手元に無いので、全部を古くする
    expect(mocks.allNotesWritten).toHaveBeenCalledTimes(1)
  })

  test('オフラインの印はまとめて付ける', async () => {
    // Act
    await actions.setItemsOfflinePinAction(form([['itemId', ID]]))

    // Assert
    expect(calls[0]).toEqual({ url: '/api/items/pin', method: 'PUT', body: { itemIds: [ID], pinned: true } })
  })
})

describe('好みと履歴', () => {
  test('並び順は cookie を書き、端末の控えも替えて 1 ページ目へ', async () => {
    // Arrange
    reply = { status: 200, body: { success: true, data: { sort: 'title' }, error: null } }

    // Act
    await actions.setSortAction(form([['sort', 'title'], ['q', '抵抗']]))

    // Assert
    expect(calls[0]).toEqual({ url: '/api/settings/sort', method: 'PUT', body: { sort: 'title', scope: 'search' } })
    expect(searchSortStore.get()).toBe('title')
    expect(mocks.navigate).toHaveBeenCalledWith('/?q=%E6%8A%B5%E6%8A%97&sort=title', { replace: true })
  })

  test('表示モードは押した瞬間に描き替える仕組みへ渡す', async () => {
    // Act
    await actions.setViewModeAction(form([['view', 'card']]))

    // Assert
    expect(mocks.switchView).toHaveBeenCalledWith('card', mocks.refresh)
  })

  test('版を刻んだら結果を添えて履歴の画面へ', async () => {
    // Arrange
    reply = { status: 200, body: { success: true, data: { result: 'committed' }, error: null } }

    // Act
    await actions.commitNoteAction(form([['itemId', ID], ['message', 'fix']]))

    // Assert
    expect(calls[0].body).toEqual({ op: 'commit', message: 'fix' })
    expect(mocks.navigate).toHaveBeenCalledWith(`/item/${ID}/history?done=committed`)
  })
})
