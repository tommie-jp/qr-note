import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Item } from '@/generated/prisma/client'
import { renderCircuits } from '@/lib/circuit/cache'
import { removeNotes } from '@/lib/git/notesRepo'
import { setItemOfflinePin } from '@/lib/items/flags'
import { getItem } from '@/lib/items/read'
import { emptyTrash, purgeItems, restoreItems, trashItems } from '@/lib/items/trash'
import { modifyMemo } from '@/lib/items/write'
import { addTagsToMemo, removeTagsFromMemo } from '@/lib/markdown/tags/edit'
import { applyBulkTags, applyTrashOp, setOfflinePins } from './bulkCommands'

// 複数のノートをまとめて書き換える本体 (docs/123 §2-1)。もとは
// app/actions.test.ts の trash / purge / bulkTag / offlinePin の節。
// 差し替えるのは Next の口・環境・DB と git と回路図の層だけで、
// タグの書き換え (tags/edit) は本物を通す
const mocks = vi.hoisted(() => ({
  demo: false,
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/appEnv', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/appEnv')>()),
  isDemoMode: () => mocks.demo,
}))
vi.mock('@/lib/items/read', () => ({ getItem: vi.fn() }))
vi.mock('@/lib/items/write', () => ({ modifyMemo: vi.fn() }))
vi.mock('@/lib/items/flags', () => ({ setItemOfflinePin: vi.fn() }))
vi.mock('@/lib/items/trash', () => ({
  emptyTrash: vi.fn(),
  purgeItems: vi.fn(),
  restoreItems: vi.fn(),
  trashItems: vi.fn(),
}))
vi.mock('@/lib/git/notesRepo', () => ({ removeNotes: vi.fn() }))
vi.mock('@/lib/circuit/cache', () => ({ renderCircuits: vi.fn() }))

const ID1 = '00000000-0000-7000-8000-000000000001'
const ID2 = '00000000-0000-7000-8000-000000000002'
const ID3 = '00000000-0000-7000-8000-000000000003'

function item(itemId: string, memo: string): Item {
  return {
    itemId,
    memo,
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
  }
}

function revalidated(): string[] {
  return mocks.revalidatePath.mock.calls.map(([path]) => path as string)
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.restoreAllMocks()
  mocks.demo = false
  vi.mocked(getItem).mockResolvedValue(null)
  vi.mocked(purgeItems).mockResolvedValue([])
  vi.mocked(emptyTrash).mockResolvedValue([])
})

describe('applyTrashOp', () => {
  test('trash は選んだノートをゴミ箱へ入れ、公開ビューを描き直させる', async () => {
    // Act
    await applyTrashOp('trash', [ID1, ID2])

    // Assert
    expect(trashItems).toHaveBeenCalledWith([ID1, ID2])
    expect(revalidated()).toEqual([`/item/${ID1}`, `/item/${ID2}`])
  })

  test('restore は戻して公開ビューを描き直させる', async () => {
    await applyTrashOp('restore', [ID1, ID2])

    expect(restoreItems).toHaveBeenCalledWith([ID1, ID2])
    expect(revalidated()).toEqual([`/item/${ID1}`, `/item/${ID2}`])
  })

  test.each(['trash', 'restore', 'purge'] as const)('%s は選択が無ければ何もしない', async (op) => {
    await applyTrashOp(op, [])

    expect(trashItems).not.toHaveBeenCalled()
    expect(restoreItems).not.toHaveBeenCalled()
    expect(purgeItems).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  test('purge は実際に消えた番号だけに墓石を立てる', async () => {
    vi.mocked(purgeItems).mockResolvedValue([ID2])

    await applyTrashOp('purge', [ID1, ID2])

    expect(purgeItems).toHaveBeenCalledWith([ID1, ID2])
    expect(removeNotes).toHaveBeenCalledWith([ID2], `delete ${ID2}`)
  })

  test('purge で何も消えなければ墓石は立てない', async () => {
    await applyTrashOp('purge', [ID1])

    expect(removeNotes).not.toHaveBeenCalled()
  })

  test('墓石に失敗しても削除はエラーにしない', async () => {
    vi.mocked(purgeItems).mockResolvedValue([ID1, ID2])
    vi.mocked(removeNotes).mockRejectedValue(new Error('git が壊れた'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(applyTrashOp('purge', [ID1, ID2])).resolves.toBeUndefined()

    expect(error).toHaveBeenCalledWith(
      `git 履歴の墓石コミットに失敗しました (${ID1}, ${ID2}):`,
      expect.any(Error),
    )
  })

  test('デモでは墓石を立てない', async () => {
    mocks.demo = true
    vi.mocked(purgeItems).mockResolvedValue([ID1])

    await applyTrashOp('purge', [ID1])

    expect(purgeItems).toHaveBeenCalled()
    expect(removeNotes).not.toHaveBeenCalled()
  })

  test('empty はゴミ箱を空にして墓石をまとめて立てる', async () => {
    vi.mocked(emptyTrash).mockResolvedValue([ID1, ID2, ID3])

    await applyTrashOp('empty', [])

    expect(removeNotes).toHaveBeenCalledWith([ID1, ID2, ID3], 'delete 3 notes')
  })
})

describe('applyBulkTags', () => {
  test('add は選んだノートごとに本文へタグを足す (当て直しの門番は渡さない)', async () => {
    vi.mocked(modifyMemo).mockResolvedValue('saved')

    await applyBulkTags('add', [ID1, ID2], ['英単語', 'toeic'])

    expect(vi.mocked(modifyMemo).mock.calls.map(([id, , options]) => [id, options])).toEqual([
      [ID1, undefined],
      [ID2, undefined],
    ])
    const transform = vi.mocked(modifyMemo).mock.calls[0][1]
    expect(transform('本文')).toBe(addTagsToMemo('本文', ['英単語', 'toeic']))
  })

  test('remove は本文からそのタグを外す', async () => {
    vi.mocked(modifyMemo).mockResolvedValue('saved')

    await applyBulkTags('remove', [ID1], ['英単語'])

    const transform = vi.mocked(modifyMemo).mock.calls[0][1]
    expect(transform('本文\n#英単語')).toBe(removeTagsFromMemo('本文\n#英単語', ['英単語']))
  })

  test.each([
    ['タグが無い', [ID1], []],
    ['選択が無い', [], ['a']],
  ])('%s なら書かない', async (_label, itemIds, tags) => {
    await applyBulkTags('add', itemIds, tags)

    expect(modifyMemo).not.toHaveBeenCalled()
  })
})

describe('setOfflinePins', () => {
  test('印を立てたノートの回路図を描く (消えたノートは飛ばす)', async () => {
    vi.mocked(getItem).mockImplementation(async (itemId) =>
      itemId === ID2 ? null : item(itemId, `本文 ${itemId}`),
    )

    await setOfflinePins([ID1, ID2, ID3], true)

    expect(vi.mocked(setItemOfflinePin).mock.calls).toEqual([
      [ID1, true],
      [ID2, true],
      [ID3, true],
    ])
    expect(vi.mocked(renderCircuits).mock.calls).toEqual([[`本文 ${ID1}`], [`本文 ${ID3}`]])
  })

  test('印を外すときは描かない', async () => {
    await setOfflinePins([ID1], false)

    expect(setItemOfflinePin).toHaveBeenCalledWith(ID1, false)
    expect(getItem).not.toHaveBeenCalled()
    expect(renderCircuits).not.toHaveBeenCalled()
  })

  test('描画に失敗しても残りの印は止めない', async () => {
    vi.mocked(getItem).mockImplementation(async (itemId) => item(itemId, '回路'))
    vi.mocked(renderCircuits).mockRejectedValue(new Error('TeX error'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await setOfflinePins([ID1, ID2], true)

    expect(setItemOfflinePin).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledWith(
      `オフライン用の回路図を描けませんでした (${ID1})`,
      expect.any(Error),
    )
  })
})
