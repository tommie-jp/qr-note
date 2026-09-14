import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Item } from '@/generated/prisma/client'
import { renderCircuits } from '@/lib/circuitCache'
import { commitNote, noteAtCommit, noteHistory, removeNotes } from '@/lib/git/notesRepo'
import { recordMeasurement } from '@/lib/healthEdit'
import { getItem } from '@/lib/items/read'
import { modifyMemo, saveItemIfUnchanged, upsertMemo } from '@/lib/items/write'
import { recordItemAccess, setItemOfflinePin, setItemPublic } from '@/lib/items/flags'
import { emptyTrash, purgeItems, restoreItems, trashItems } from '@/lib/items/trash'
import { backfillAllNotes } from '@/lib/noteHistoryBackfill'
import { addTagsToMemo, removeTagsFromMemo } from '@/lib/markdown/tags/edit'
import { differsOnlyInTaskMarks } from '@/lib/markdown/taskCheckbox'
import { MAX_TEXT_LENGTH } from '@/lib/validation'
import {
  backfillHistoryAction,
  bulkTagAction,
  commitNoteAction,
  emptyTrashAction,
  purgeItemsAction,
  recordAccessAction,
  recordHealthAction,
  restoreItemsAction,
  restoreNoteVersionAction,
  setItemOfflinePinAction,
  setItemPublicAction,
  setItemsOfflinePinAction,
  setPaneModeAction,
  setSortAction,
  setTrashSortAction,
  setViewModeAction,
  toggleMemoTaskAction,
  trashItemsAction,
  updateItemAction,
  updateMemoAction,
} from './actions'

// サーバーアクションの直接テスト (docs/93-リファクタリング計画.md §4-6)。
//
// Server Action は「画面に置いたボタン」ではなく誰でも叩ける POST の口なので、
// 門番の順番 (ログイン → デモ拒否 → 入力の検め) と、書き込み・再検証・遷移の
// 組み合わせをここで押さえる。分割してもこの表が変わらないことが合格条件。
//
// 差し替えるのは Next の口 (cookies / redirect / revalidatePath / after)、
// セッション、環境、DB と git に触る層だけ。フォームの解釈 (itemSelection・
// bulkTags・saveBase) と本文の書き換え (taskCheckbox・tagEdit・healthEdit) は
// 本物を通す
const mocks = vi.hoisted(() => {
  // Next の redirect() は投げて処理を打ち切る。同じく投げて行き先を持たせる
  class RedirectSignal extends Error {
    constructor(readonly url: string) {
      super(`NEXT_REDIRECT ${url}`)
    }
  }
  return {
    RedirectSignal,
    user: 'tommie' as string | null,
    demo: false,
    production: false,
    afterTasks: [] as Array<() => Promise<void>>,
    setCookie: vi.fn(),
    revalidatePath: vi.fn(),
    redirect: vi.fn((url: string) => {
      throw new RedirectSignal(url)
    }),
  }
})

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('next/headers', () => ({
  cookies: async () => ({ set: mocks.setCookie }),
}))
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => Promise<void>) => {
    mocks.afterTasks.push(task)
  },
}))
vi.mock('@/lib/auth/session', () => ({
  currentUser: async () => mocks.user,
  // 本物と同じ文言で投げる (auth/session.ts の UnauthorizedError)
  requireUser: async () => {
    if (mocks.user === null) {
      throw new Error('ログインが必要です')
    }
    return mocks.user
  },
}))
vi.mock('@/lib/appEnv', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/appEnv')>()),
  isDemoMode: () => mocks.demo,
  isNodeEnvProduction: () => mocks.production,
}))
vi.mock('@/lib/items/read', () => ({
  getItem: vi.fn(),
}))
vi.mock('@/lib/items/write', () => ({
  modifyMemo: vi.fn(),
  saveItemIfUnchanged: vi.fn(),
  upsertMemo: vi.fn(),
}))
vi.mock('@/lib/items/flags', () => ({
  recordItemAccess: vi.fn(),
  setItemOfflinePin: vi.fn(),
  setItemPublic: vi.fn(),
}))
vi.mock('@/lib/items/trash', () => ({
  emptyTrash: vi.fn(),
  purgeItems: vi.fn(),
  restoreItems: vi.fn(),
  trashItems: vi.fn(),
}))
vi.mock('@/lib/git/notesRepo', () => ({
  commitNote: vi.fn(),
  noteAtCommit: vi.fn(),
  noteHistory: vi.fn(),
  removeNotes: vi.fn(),
}))
vi.mock('@/lib/circuitCache', () => ({ renderCircuits: vi.fn() }))
vi.mock('@/lib/noteHistoryBackfill', () => ({ backfillAllNotes: vi.fn() }))

const NOW = 1_757_808_000_000
const OID = 'a'.repeat(40)
const YEAR_SECONDS = 60 * 60 * 24 * 365

function item(overrides: Partial<Item> = {}): Item {
  return {
    itemNo: '1',
    itemNoNum: 1,
    memo: 'いまの本文',
    url: '',
    mode: 'memo',
    title: '',
    tags: [],
    props: [],
    taskTodo: 0,
    taskDone: 0,
    createdAt: new Date(1_000),
    updatedAt: new Date(2_000),
    accessedAt: new Date(2_000),
    deletedAt: null,
    publicAt: null,
    offlinePin: false,
    ...overrides,
  }
}

function form(fields: Record<string, string | string[]>): FormData {
  const formData = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    for (const one of Array.isArray(value) ? value : [value]) {
      formData.append(key, one)
    }
  }
  return formData
}

// 一覧から選んだノートの一括操作フォーム (戻り先の q/page/sort 付き)
function selection(itemNos: string[], extra: Record<string, string> = {}): FormData {
  return form({ itemNo: itemNos, q: 'abc', page: '2', sort: 'title', ...extra })
}
const BACK = '/?q=abc&page=2&sort=title'

// redirect() で終わったことを確かめ、行き先を返す
async function redirectOf(run: Promise<unknown>): Promise<string> {
  const outcome = await run.then(
    () => null,
    (reason: unknown) => reason,
  )
  if (!(outcome instanceof mocks.RedirectSignal)) {
    throw new Error(`redirect されずに終わった: ${String(outcome)}`)
  }
  return outcome.url
}

function revalidated(): string[] {
  return mocks.revalidatePath.mock.calls.map(([path]) => path as string)
}

function cookieOptions(maxAge: number, secure = false) {
  return { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.user = 'tommie'
  mocks.demo = false
  mocks.production = false
  mocks.afterTasks = []
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  vi.mocked(getItem).mockResolvedValue(null)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('updateMemoAction', () => {
  const saveForm = (extra: Record<string, string> = {}) =>
    form({ itemNo: '1', memo: '新しい本文', base: '2000', ...extra })

  test('基点が同じなら保存し、図を後で描く予約をして保存済みの印へ遷移する', async () => {
    vi.mocked(saveItemIfUnchanged).mockResolvedValue({ ok: true, item: item() })

    const url = await redirectOf(updateMemoAction(null, saveForm()))

    expect(url).toBe(`/item/1?saved=${NOW}`)
    expect(saveItemIfUnchanged).toHaveBeenCalledWith(
      '1',
      { memo: '新しい本文' },
      { kind: 'at', at: new Date(2000) },
    )
    expect(revalidated()).toEqual(['/item/1'])
    expect(mocks.afterTasks).toHaveLength(1)
    expect(commitNote).not.toHaveBeenCalled()
  })

  test('応答後の図の描画は保存した本文で走り、失敗しても投げない', async () => {
    vi.mocked(saveItemIfUnchanged).mockResolvedValue({ ok: true, item: item() })
    vi.mocked(renderCircuits).mockRejectedValue(new Error('TeX error'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await redirectOf(updateMemoAction(null, saveForm()))

    await mocks.afterTasks[0]()

    expect(renderCircuits).toHaveBeenCalledWith('新しい本文')
    expect(warn).toHaveBeenCalledWith('保存後の回路図を描けませんでした (1)', expect.any(Error))
  })

  test('未ログインは入力を読む前に断る', async () => {
    mocks.user = null

    await expect(updateMemoAction(null, form({ itemNo: '../x' }))).rejects.toThrow(
      'ログインが必要です',
    )
    expect(saveItemIfUnchanged).not.toHaveBeenCalled()
  })

  test.each([
    ['itemNo が不正', { itemNo: '../x' }, 'itemNo が不正です'],
    ['基点が読めない', { base: 'latest' }, '保存の基点が不正です'],
    ['基点が無い', { base: '' }, '保存の基点が不正です'],
    [
      '本文が上限を超える',
      { memo: 'あ'.repeat(MAX_TEXT_LENGTH + 1) },
      `memo が長すぎます (最大 ${MAX_TEXT_LENGTH} 文字)`,
    ],
  ])('%s なら書かずに投げる', async (_label, extra, message) => {
    await expect(updateMemoAction(null, saveForm(extra))).rejects.toThrow(message)
    expect(saveItemIfUnchanged).not.toHaveBeenCalled()
  })

  test('基点がずれていたら書かずに競合を返す (遷移も再検証もしない)', async () => {
    const current = item({ memo: '別の端末の本文', updatedAt: new Date(3_000) })
    vi.mocked(saveItemIfUnchanged).mockResolvedValue({ ok: false, reason: 'conflict', current })

    const state = await updateMemoAction(null, saveForm())

    expect(state).toStrictEqual({
      seq: NOW,
      kind: 'conflict',
      server: { memo: '別の端末の本文', url: '', mode: 'memo', updatedAt: 3_000, deletedAt: null },
    })
    expect(mocks.redirect).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
    expect(mocks.afterTasks).toEqual([])
  })

  test('編集中に永久削除されていたら server は null', async () => {
    vi.mocked(saveItemIfUnchanged).mockResolvedValue({ ok: false, reason: 'missing' })

    const state = await updateMemoAction(null, saveForm())

    expect(state).toStrictEqual({ seq: NOW, kind: 'missing', server: null })
  })

  test('「このまま上書き」は消える版を先に刻んでから保存する', async () => {
    vi.mocked(getItem).mockResolvedValue(item({ memo: '消える版' }))
    vi.mocked(saveItemIfUnchanged).mockResolvedValue({ ok: true, item: item() })

    await redirectOf(updateMemoAction(null, saveForm({ checkpoint: '1' })))

    expect(commitNote).toHaveBeenCalledWith('1', '消える版', 'conflict 1')
    expect(vi.mocked(commitNote).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(saveItemIfUnchanged).mock.invocationCallOrder[0],
    )
  })

  test('いまの版と同じ本文なら刻まずに保存する', async () => {
    vi.mocked(getItem).mockResolvedValue(item({ memo: '新しい本文' }))
    vi.mocked(saveItemIfUnchanged).mockResolvedValue({ ok: true, item: item() })

    await redirectOf(updateMemoAction(null, saveForm({ checkpoint: '1' })))

    expect(commitNote).not.toHaveBeenCalled()
  })

  test('デモでは刻まずに保存する (履歴機能ごと閉じている)', async () => {
    mocks.demo = true
    vi.mocked(getItem).mockResolvedValue(item({ memo: '消える版' }))
    vi.mocked(saveItemIfUnchanged).mockResolvedValue({ ok: true, item: item() })

    await redirectOf(updateMemoAction(null, saveForm({ checkpoint: '1' })))

    expect(commitNote).not.toHaveBeenCalled()
    expect(saveItemIfUnchanged).toHaveBeenCalled()
  })

  test('刻めなければ上書きせず checkpointFailed を返す', async () => {
    const current = item({ memo: '消える版' })
    vi.mocked(getItem).mockResolvedValue(current)
    vi.mocked(commitNote).mockRejectedValue(new Error('git が壊れた'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    const state = await updateMemoAction(null, saveForm({ checkpoint: '1' }))

    expect(state).toStrictEqual({
      seq: NOW,
      kind: 'checkpointFailed',
      server: { memo: '消える版', url: '', mode: 'memo', updatedAt: 2_000, deletedAt: null },
    })
    expect(saveItemIfUnchanged).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(
      '競合チェックポイントのコミットに失敗しました (1)',
      expect.any(Error),
    )
  })
})

describe('updateItemAction', () => {
  const editForm = (extra: Record<string, string> = {}) =>
    form({ itemNo: '7', memo: '本文', url: 'https://example.com', mode: 'url', base: 'new', ...extra })

  test('mode / memo / url を保存して保存済みの印へ遷移する', async () => {
    vi.mocked(saveItemIfUnchanged).mockResolvedValue({ ok: true, item: item() })

    const url = await redirectOf(updateItemAction(null, editForm()))

    expect(url).toBe(`/item/7?saved=${NOW}`)
    expect(saveItemIfUnchanged).toHaveBeenCalledWith(
      '7',
      { memo: '本文', url: 'https://example.com', mode: 'url' },
      { kind: 'new' },
    )
    expect(revalidated()).toEqual(['/item/7'])
    expect(mocks.afterTasks).toHaveLength(1)
  })

  test('判らない mode は memo に倒す', async () => {
    vi.mocked(saveItemIfUnchanged).mockResolvedValue({ ok: true, item: item() })

    await redirectOf(updateItemAction(null, editForm({ mode: 'html' })))

    expect(vi.mocked(saveItemIfUnchanged).mock.calls[0][1]).toStrictEqual({
      memo: '本文',
      url: 'https://example.com',
      mode: 'memo',
    })
  })

  test('新規のはずが行があれば exists といまの版を返す', async () => {
    const current = item({ itemNo: '7', url: 'https://old.example.com', mode: 'url' })
    vi.mocked(saveItemIfUnchanged).mockResolvedValue({ ok: false, reason: 'exists', current })

    const state = await updateItemAction(null, editForm())

    expect(state).toStrictEqual({
      seq: NOW,
      kind: 'exists',
      server: {
        memo: 'いまの本文',
        url: 'https://old.example.com',
        mode: 'url',
        updatedAt: 2_000,
        deletedAt: null,
      },
    })
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  test('url が上限を超えたら書かずに投げる', async () => {
    const tooLong = editForm({ url: 'x'.repeat(MAX_TEXT_LENGTH + 1) })

    await expect(updateItemAction(null, tooLong)).rejects.toThrow('url が長すぎます')
    expect(saveItemIfUnchanged).not.toHaveBeenCalled()
  })

  test('未ログインは断る', async () => {
    mocks.user = null

    await expect(updateItemAction(null, editForm())).rejects.toThrow('ログインが必要です')
    expect(saveItemIfUnchanged).not.toHaveBeenCalled()
  })
})

describe('toggleMemoTaskAction', () => {
  test('行番号を検算しながら書き換え、ノートと一覧を再検証する', async () => {
    vi.mocked(modifyMemo).mockResolvedValue('saved')

    await toggleMemoTaskAction('1', 2, true)

    const [itemNo, transform, options] = vi.mocked(modifyMemo).mock.calls[0]
    expect(itemNo).toBe('1')
    expect(transform('# 単語\n- [ ] apple')).toBe('# 単語\n- [x] apple')
    expect(transform('# 単語\n本文')).toBeNull()
    expect(options).toStrictEqual({ canRetry: differsOnlyInTaskMarks })
    expect(revalidated()).toEqual(['/item/1', '/'])
  })

  test('未ログインは断る', async () => {
    mocks.user = null

    await expect(toggleMemoTaskAction('1', 1, true)).rejects.toThrow('ログインが必要です')
    expect(modifyMemo).not.toHaveBeenCalled()
  })

  test('itemNo が不正なら書かない', async () => {
    await expect(toggleMemoTaskAction('../1', 1, true)).rejects.toThrow('itemNo が不正です')
    expect(modifyMemo).not.toHaveBeenCalled()
  })

  test.each([
    ['missing', 'ノートが見つかりません'],
    ['rejected', '本文が変わっています。画面を更新してください'],
  ] as const)('%s なら再検証せずに投げる', async (outcome, message) => {
    vi.mocked(modifyMemo).mockResolvedValue(outcome)

    await expect(toggleMemoTaskAction('1', 1, true)).rejects.toThrow(message)
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})

describe('recordHealthAction', () => {
  const entry = { date: '2026-09-14', item: '体重', values: [66.4], unit: 'kg' }

  test('記録を書き込み、ノートと一覧を再検証する (当て直しの門番は渡さない)', async () => {
    vi.mocked(modifyMemo).mockResolvedValue('saved')

    await recordHealthAction('1', entry.date, entry.item, entry.values, entry.unit)

    const [itemNo, transform, options] = vi.mocked(modifyMemo).mock.calls[0]
    expect(itemNo).toBe('1')
    expect(options).toBeUndefined()
    expect(transform('# 体重\n')).toBe(recordMeasurement('# 体重\n', entry))
    expect(revalidated()).toEqual(['/item/1', '/'])
  })

  test('書き込んだ本文が上限を超えるなら投げる', async () => {
    vi.mocked(modifyMemo).mockResolvedValue('saved')
    await recordHealthAction('1', entry.date, entry.item, entry.values, entry.unit)
    const transform = vi.mocked(modifyMemo).mock.calls[0][1]

    expect(() => transform('あ'.repeat(MAX_TEXT_LENGTH))).toThrow(
      `本文が長すぎます (最大 ${MAX_TEXT_LENGTH} 文字)`,
    )
  })

  test('未ログインは断る', async () => {
    mocks.user = null

    await expect(recordHealthAction('1', entry.date, entry.item, [1], '')).rejects.toThrow(
      'ログインが必要です',
    )
    expect(modifyMemo).not.toHaveBeenCalled()
  })

  test.each([
    ['値が空', []],
    ['値が多すぎる', [1, 2, 3, 4]],
    ['数でない値', [Number.NaN]],
    // eslint の no-sparse-arrays を避けて疎配列を作る
    ['疎配列', Object.assign(new Array<number>(2), { 1: 1 })],
  ])('%s は書かずに投げる', async (_label, values) => {
    await expect(recordHealthAction('1', entry.date, entry.item, values, '')).rejects.toThrow(
      '記録の値が不正です',
    )
    expect(modifyMemo).not.toHaveBeenCalled()
  })

  test('文字列でない項目名は書かずに投げる', async () => {
    const notString = 1 as unknown as string

    await expect(recordHealthAction('1', entry.date, notString, [1], '')).rejects.toThrow(
      '記録の値が不正です',
    )
  })

  test('itemNo が不正なら書かない', async () => {
    await expect(recordHealthAction('x/y', entry.date, entry.item, [1], '')).rejects.toThrow(
      'itemNo が不正です',
    )
  })

  test.each([
    ['missing', 'ノートが見つかりません'],
    ['rejected', 'この値は記録できません'],
  ] as const)('%s なら再検証せずに投げる', async (outcome, message) => {
    vi.mocked(modifyMemo).mockResolvedValue(outcome)

    await expect(
      recordHealthAction('1', entry.date, entry.item, entry.values, entry.unit),
    ).rejects.toThrow(message)
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})

describe('setItemPublicAction', () => {
  test.each([
    ['1', true],
    ['0', false],
    ['yes', false],
  ])('public=%s は %s として書き、ノートを再検証する', async (value, expected) => {
    await setItemPublicAction(form({ itemNo: '1', public: value }))

    expect(setItemPublic).toHaveBeenCalledWith('1', expected)
    expect(revalidated()).toEqual(['/item/1'])
  })

  test('デモでは断る', async () => {
    mocks.demo = true

    await expect(setItemPublicAction(form({ itemNo: '1', public: '1' }))).rejects.toThrow(
      'デモモードでは公開機能は使えません',
    )
    expect(setItemPublic).not.toHaveBeenCalled()
  })

  test('ログインの検査がデモ拒否より先', async () => {
    mocks.user = null
    mocks.demo = true

    await expect(setItemPublicAction(form({ itemNo: '1' }))).rejects.toThrow('ログインが必要です')
  })

  test('デモ拒否が itemNo の検めより先', async () => {
    mocks.demo = true

    await expect(setItemPublicAction(form({ itemNo: '../1' }))).rejects.toThrow(
      'デモモードでは公開機能は使えません',
    )
  })
})

describe('setItemOfflinePinAction', () => {
  test('印を立てるときは回路図を描いてから再検証する', async () => {
    vi.mocked(getItem).mockResolvedValue(item({ memo: '回路の本文' }))

    await setItemOfflinePinAction(form({ itemNo: '1', pin: '1' }))

    expect(setItemOfflinePin).toHaveBeenCalledWith('1', true)
    expect(renderCircuits).toHaveBeenCalledWith('回路の本文')
    expect(revalidated()).toEqual(['/item/1'])
  })

  test('印を外すときは描かない', async () => {
    await setItemOfflinePinAction(form({ itemNo: '1', pin: '0' }))

    expect(setItemOfflinePin).toHaveBeenCalledWith('1', false)
    expect(getItem).not.toHaveBeenCalled()
    expect(renderCircuits).not.toHaveBeenCalled()
  })

  test('描画に失敗してもトグルは止めない', async () => {
    vi.mocked(getItem).mockResolvedValue(item())
    vi.mocked(renderCircuits).mockRejectedValue(new Error('TeX error'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await setItemOfflinePinAction(form({ itemNo: '1', pin: '1' }))

    expect(warn).toHaveBeenCalledWith('オフライン用の回路図を描けませんでした (1)', expect.any(Error))
    expect(revalidated()).toEqual(['/item/1'])
  })

  test('デモでは断る', async () => {
    mocks.demo = true

    await expect(setItemOfflinePinAction(form({ itemNo: '1', pin: '1' }))).rejects.toThrow(
      'デモモードではオフライン保存は使えません',
    )
    expect(setItemOfflinePin).not.toHaveBeenCalled()
  })

  test('未ログインは断る', async () => {
    mocks.user = null

    await expect(setItemOfflinePinAction(form({ itemNo: '1', pin: '1' }))).rejects.toThrow(
      'ログインが必要です',
    )
  })
})

describe('setItemsOfflinePinAction', () => {
  test('選んだノートに印を立てて図を描き、一覧を再検証して戻る', async () => {
    vi.mocked(getItem).mockImplementation(async (itemNo) =>
      itemNo === '2' ? null : item({ itemNo, memo: `本文 ${itemNo}` }),
    )

    const url = await redirectOf(setItemsOfflinePinAction(selection(['1', '2', '3'])))

    expect(url).toBe(BACK)
    expect(vi.mocked(setItemOfflinePin).mock.calls).toEqual([
      ['1', true],
      ['2', true],
      ['3', true],
    ])
    expect(vi.mocked(renderCircuits).mock.calls).toEqual([['本文 1'], ['本文 3']])
    expect(revalidated()).toEqual(['/'])
  })

  test('選択が無ければ再検証せずに戻る', async () => {
    const url = await redirectOf(setItemsOfflinePinAction(selection([])))

    expect(url).toBe(BACK)
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  test('デモでは断る', async () => {
    mocks.demo = true

    await expect(setItemsOfflinePinAction(selection(['1']))).rejects.toThrow(
      'デモモードではオフライン保存は使えません',
    )
    expect(setItemOfflinePin).not.toHaveBeenCalled()
  })
})

describe('trashItemsAction', () => {
  test('選んだノートをゴミ箱へ入れ、一覧とゴミ箱を再検証して戻る', async () => {
    const url = await redirectOf(trashItemsAction(selection(['1', '../x', '2', '1'])))

    expect(url).toBe(BACK)
    expect(trashItems).toHaveBeenCalledWith(['1', '2'])
    expect(revalidated()).toEqual(['/', '/trash'])
  })

  test('選択が無ければ何も書かずに戻る', async () => {
    const url = await redirectOf(trashItemsAction(selection([])))

    expect(url).toBe(BACK)
    expect(trashItems).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  test('未ログインは断る', async () => {
    mocks.user = null

    await expect(trashItemsAction(selection(['1']))).rejects.toThrow('ログインが必要です')
    expect(trashItems).not.toHaveBeenCalled()
  })
})

describe('restoreItemsAction', () => {
  test('戻して一覧・ゴミ箱・各ノートを再検証する (遷移はしない)', async () => {
    await restoreItemsAction(selection(['1', '2']))

    expect(restoreItems).toHaveBeenCalledWith(['1', '2'])
    expect(revalidated()).toEqual(['/', '/trash', '/item/1', '/item/2'])
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  test('選択が無ければ何もしない', async () => {
    await restoreItemsAction(selection([]))

    expect(restoreItems).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  test('未ログインは断る', async () => {
    mocks.user = null

    await expect(restoreItemsAction(selection(['1']))).rejects.toThrow('ログインが必要です')
  })
})

describe('purgeItemsAction', () => {
  test('実際に消えた番号だけに墓石を立てて再検証する', async () => {
    vi.mocked(purgeItems).mockResolvedValue(['2'])

    await purgeItemsAction(selection(['1', '2']))

    expect(purgeItems).toHaveBeenCalledWith(['1', '2'])
    expect(removeNotes).toHaveBeenCalledWith(['2'], 'delete 2')
    expect(revalidated()).toEqual(['/', '/trash'])
  })

  test('何も消えなければ墓石は立てない', async () => {
    vi.mocked(purgeItems).mockResolvedValue([])

    await purgeItemsAction(selection(['1']))

    expect(removeNotes).not.toHaveBeenCalled()
    expect(revalidated()).toEqual(['/', '/trash'])
  })

  test('墓石に失敗しても削除はエラーにしない', async () => {
    vi.mocked(purgeItems).mockResolvedValue(['1', '2'])
    vi.mocked(removeNotes).mockRejectedValue(new Error('git が壊れた'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await purgeItemsAction(selection(['1', '2']))

    expect(error).toHaveBeenCalledWith(
      'git 履歴の墓石コミットに失敗しました (1, 2):',
      expect.any(Error),
    )
    expect(revalidated()).toEqual(['/', '/trash'])
  })

  test('デモでは墓石を立てない', async () => {
    mocks.demo = true
    vi.mocked(purgeItems).mockResolvedValue(['1'])

    await purgeItemsAction(selection(['1']))

    expect(removeNotes).not.toHaveBeenCalled()
  })

  test('選択が無ければ何もしない', async () => {
    await purgeItemsAction(selection([]))

    expect(purgeItems).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  test('未ログインは断る', async () => {
    mocks.user = null

    await expect(purgeItemsAction(selection(['1']))).rejects.toThrow('ログインが必要です')
    expect(purgeItems).not.toHaveBeenCalled()
  })
})

describe('emptyTrashAction', () => {
  test('ゴミ箱を空にして墓石をまとめて立て、再検証する', async () => {
    vi.mocked(emptyTrash).mockResolvedValue(['1', '2', '3'])

    await emptyTrashAction()

    expect(removeNotes).toHaveBeenCalledWith(['1', '2', '3'], 'delete 3 notes')
    expect(revalidated()).toEqual(['/', '/trash'])
  })

  test('未ログインは断る', async () => {
    mocks.user = null

    await expect(emptyTrashAction()).rejects.toThrow('ログインが必要です')
    expect(emptyTrash).not.toHaveBeenCalled()
  })
})

describe('bulkTagAction', () => {
  test('追加は選んだノートごとに本文へタグを足し、一覧を再検証して戻る', async () => {
    vi.mocked(modifyMemo).mockResolvedValue('saved')

    const url = await redirectOf(bulkTagAction(selection(['1', '2'], { addTags: '#英単語 #TOEIC' })))

    expect(url).toBe(BACK)
    expect(vi.mocked(modifyMemo).mock.calls.map(([itemNo, , options]) => [itemNo, options])).toEqual([
      ['1', undefined],
      ['2', undefined],
    ])
    const transform = vi.mocked(modifyMemo).mock.calls[0][1]
    expect(transform('本文')).toBe(addTagsToMemo('本文', ['英単語', 'toeic']))
    expect(revalidated()).toEqual(['/'])
  })

  test('削除チップは本文からそのタグを外す', async () => {
    vi.mocked(modifyMemo).mockResolvedValue('saved')

    await redirectOf(bulkTagAction(selection(['1'], { removeTag: '英単語' })))

    const transform = vi.mocked(modifyMemo).mock.calls[0][1]
    expect(transform('本文\n#英単語')).toBe(removeTagsFromMemo('本文\n#英単語', ['英単語']))
  })

  test('タグが無ければ書かずに戻る', async () => {
    const url = await redirectOf(bulkTagAction(selection(['1'], { addTags: '  ' })))

    expect(url).toBe(BACK)
    expect(modifyMemo).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  test('未ログインは断る', async () => {
    mocks.user = null

    await expect(bulkTagAction(selection(['1'], { addTags: '#a' }))).rejects.toThrow(
      'ログインが必要です',
    )
    expect(modifyMemo).not.toHaveBeenCalled()
  })
})

describe('recordAccessAction', () => {
  test('ログイン中なら開いた日時を記録する', async () => {
    await recordAccessAction('1')

    expect(recordItemAccess).toHaveBeenCalledWith('1')
  })

  test('未ログインは投げずに何もしない (公開ノートを開いた人にエラーを見せない)', async () => {
    mocks.user = null

    await expect(recordAccessAction('1')).resolves.toBeUndefined()
    expect(recordItemAccess).not.toHaveBeenCalled()
  })

  test('itemNo が不正なら何もしない', async () => {
    await expect(recordAccessAction('../1')).resolves.toBeUndefined()
    expect(recordItemAccess).not.toHaveBeenCalled()
  })

  test('記録に失敗しても投げない', async () => {
    vi.mocked(recordItemAccess).mockRejectedValue(new Error('DB が落ちた'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(recordAccessAction('1')).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledWith('アクセス日時を記録できませんでした (1):', expect.any(Error))
  })
})

// 見た目の好みの cookie。requireUser を呼ばない (未ログインでも書ける)
describe('表示の好み (cookie)', () => {
  test('setPaneModeAction はペイン構成を cookie に書き、遷移も再検証もしない', async () => {
    mocks.user = null

    await setPaneModeAction(form({ panes: '3' }))

    expect(mocks.setCookie.mock.calls).toStrictEqual([
      ['panes', '3', cookieOptions(YEAR_SECONDS)],
    ])
    expect(mocks.redirect).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  test('setPaneModeAction は判らない値を既定の 2 に畳む', async () => {
    await setPaneModeAction(form({ panes: '9' }))

    expect(mocks.setCookie).toHaveBeenCalledWith('panes', '2', cookieOptions(YEAR_SECONDS))
  })

  test('setViewModeAction は表示モードを cookie に書き、遷移も再検証もしない', async () => {
    mocks.user = null

    await setViewModeAction(form({ view: 'card' }))

    expect(mocks.setCookie.mock.calls).toStrictEqual([
      ['view', 'card', cookieOptions(YEAR_SECONDS)],
    ])
    expect(mocks.redirect).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  test('setViewModeAction は判らない値を既定の compact に畳む', async () => {
    await setViewModeAction(form({ view: 'huge' }))

    expect(mocks.setCookie).toHaveBeenCalledWith('view', 'compact', cookieOptions(YEAR_SECONDS))
  })

  test('本番では secure を付ける', async () => {
    mocks.production = true

    await setViewModeAction(form({ view: 'card' }))

    expect(mocks.setCookie).toHaveBeenCalledWith('view', 'card', cookieOptions(YEAR_SECONDS, true))
  })

  test('setSortAction は並びを cookie に書き、検索語を持ち回して 1 ページ目へ遷移する', async () => {
    mocks.user = null

    const url = await redirectOf(setSortAction(form({ sort: 'title', q: 'abc', page: '3' })))

    expect(url).toBe('/?q=abc&sort=title')
    expect(mocks.setCookie.mock.calls).toStrictEqual([
      ['sort', 'title', cookieOptions(YEAR_SECONDS)],
    ])
  })

  test('setSortAction は判らない並びを updated に畳む', async () => {
    const url = await redirectOf(setSortAction(form({ sort: 'random' })))

    expect(url).toBe('/')
    expect(mocks.setCookie).toHaveBeenCalledWith('sort', 'updated', cookieOptions(YEAR_SECONDS))
  })

  test('setTrashSortAction はゴミ箱の並びを別の cookie に書いてゴミ箱へ遷移する', async () => {
    mocks.user = null

    const url = await redirectOf(setTrashSortAction(form({ trashSort: 'updated' })))

    expect(url).toBe('/trash?sort=updated')
    expect(mocks.setCookie.mock.calls).toStrictEqual([
      ['trashSort', 'updated', cookieOptions(YEAR_SECONDS)],
    ])
  })

  test('setTrashSortAction は判らない並びを削除順に畳み、素の /trash へ戻る', async () => {
    const url = await redirectOf(setTrashSortAction(form({ trashSort: 'random' })))

    expect(url).toBe('/trash')
    expect(mocks.setCookie).toHaveBeenCalledWith('trashSort', 'deleted', cookieOptions(YEAR_SECONDS))
  })
})

describe('commitNoteAction', () => {
  test('DB のいまの本文を、整えた 1 行目のメッセージでコミットする', async () => {
    vi.mocked(getItem).mockResolvedValue(item({ memo: 'DB の本文' }))
    vi.mocked(commitNote).mockResolvedValue(OID)

    const url = await redirectOf(
      commitNoteAction(form({ itemNo: '1', message: ' fix\x07 typo \n2 行目', memo: '画面の本文' })),
    )

    expect(url).toBe('/item/1/history?done=committed')
    expect(commitNote).toHaveBeenCalledWith('1', 'DB の本文', 'fix typo')
    expect(revalidated()).toEqual(['/item/1/history'])
  })

  test('メッセージが空なら既定文言、変化なしなら noop へ遷移する', async () => {
    vi.mocked(getItem).mockResolvedValue(item())
    vi.mocked(commitNote).mockResolvedValue(null)

    const url = await redirectOf(commitNoteAction(form({ itemNo: '1', message: '\x1b ' })))

    expect(url).toBe('/item/1/history?done=noop')
    expect(commitNote).toHaveBeenCalledWith('1', 'いまの本文', 'update 1')
  })

  test('ノートが無ければ投げる', async () => {
    await expect(commitNoteAction(form({ itemNo: '1' }))).rejects.toThrow('ノートが見つかりません')
    expect(commitNote).not.toHaveBeenCalled()
  })

  test('デモでは入力を読む前に断る', async () => {
    mocks.demo = true

    await expect(commitNoteAction(form({ itemNo: '../1' }))).rejects.toThrow(
      'デモモードでは履歴機能は使えません',
    )
  })

  test('ログインの検査がデモ拒否より先', async () => {
    mocks.user = null
    mocks.demo = true

    await expect(commitNoteAction(form({ itemNo: '1' }))).rejects.toThrow('ログインが必要です')
  })
})

describe('restoreNoteVersionAction', () => {
  const restoreForm = (oid = OID) => form({ itemNo: '1', oid })

  function historyWith(oid: string): void {
    vi.mocked(noteHistory).mockResolvedValue([
      { oid, parentOid: null, date: '2026-09-01T00:00:00+09:00', message: 'update 1' },
    ])
  }

  test('消える版を刻んでから過去の本文を保存経路で書き戻す', async () => {
    historyWith(OID)
    vi.mocked(noteAtCommit).mockResolvedValue('過去の本文')
    vi.mocked(getItem).mockResolvedValue(item({ memo: 'いまの本文' }))

    const url = await redirectOf(restoreNoteVersionAction(restoreForm()))

    expect(url).toBe(`/item/1?saved=${NOW}`)
    expect(noteAtCommit).toHaveBeenCalledWith('1', OID)
    expect(commitNote).toHaveBeenCalledWith('1', 'いまの本文', 'conflict 1')
    expect(upsertMemo).toHaveBeenCalledWith('1', '過去の本文')
    expect(revalidated()).toEqual(['/item/1'])
  })

  test('oid の書式が不正なら履歴を引かない', async () => {
    await expect(restoreNoteVersionAction(restoreForm('HEAD'))).rejects.toThrow(
      'コミット oid が不正です',
    )
    expect(noteHistory).not.toHaveBeenCalled()
  })

  test('このノートの履歴に無い oid は断る', async () => {
    historyWith('b'.repeat(40))

    await expect(restoreNoteVersionAction(restoreForm())).rejects.toThrow(
      'このノートの履歴にないコミットです',
    )
    expect(noteAtCommit).not.toHaveBeenCalled()
  })

  test('その版に本文が無ければ断る', async () => {
    historyWith(OID)
    vi.mocked(noteAtCommit).mockResolvedValue(null)

    await expect(restoreNoteVersionAction(restoreForm())).rejects.toThrow(
      'この版にノートの本文がありません',
    )
    expect(upsertMemo).not.toHaveBeenCalled()
  })

  test('いまの本文を刻めなければ復元しない', async () => {
    historyWith(OID)
    vi.mocked(noteAtCommit).mockResolvedValue('過去の本文')
    vi.mocked(getItem).mockResolvedValue(item())
    vi.mocked(commitNote).mockRejectedValue(new Error('git が壊れた'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(restoreNoteVersionAction(restoreForm())).rejects.toThrow(
      'いまの本文を履歴に残せませんでした。復元していません',
    )
    expect(upsertMemo).not.toHaveBeenCalled()
  })

  test('デモでは断る', async () => {
    mocks.demo = true

    await expect(restoreNoteVersionAction(restoreForm())).rejects.toThrow(
      'デモモードでは履歴機能は使えません',
    )
    expect(noteHistory).not.toHaveBeenCalled()
  })

  test('未ログインは断る', async () => {
    mocks.user = null

    await expect(restoreNoteVersionAction(restoreForm())).rejects.toThrow('ログインが必要です')
  })
})

describe('backfillHistoryAction', () => {
  test.each([
    [OID, '/settings/history?done=imported'],
    [null, '/settings/history?done=noop'],
  ])('取り込みの結果 (oid=%s) を ?done= に載せて設定画面へ戻る', async (oid, expected) => {
    vi.mocked(backfillAllNotes).mockResolvedValue({ count: 3, oid })

    expect(await redirectOf(backfillHistoryAction())).toBe(expected)
  })

  test('デモでは断る', async () => {
    mocks.demo = true

    await expect(backfillHistoryAction()).rejects.toThrow('デモモードでは履歴機能は使えません')
    expect(backfillAllNotes).not.toHaveBeenCalled()
  })

  test('未ログインは断る', async () => {
    mocks.user = null

    await expect(backfillHistoryAction()).rejects.toThrow('ログインが必要です')
    expect(backfillAllNotes).not.toHaveBeenCalled()
  })
})
