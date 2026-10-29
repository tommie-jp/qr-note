import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Item } from '@/generated/prisma/client'
import { backfillAllNotes } from '@/lib/git/noteHistoryBackfill'
import { commitNote, noteAtCommit, noteHistory } from '@/lib/git/notesRepo'
import { getItem } from '@/lib/items/read'
import { upsertMemo } from '@/lib/items/write'
import { backfillHistory, commitNoteVersion, restoreNoteVersion } from './historyCommands'

// git 履歴の書き込み (docs/57)。もとは app/actions.test.ts の
// commitNote / restoreNoteVersion / backfillHistory の節。
// デモの拒否は route の門番が持つので、ここでは見ない (route テスト側)
const mocks = vi.hoisted(() => ({ demo: false }))

vi.mock('@/lib/appEnv', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/appEnv')>()),
  isDemoMode: () => mocks.demo,
}))
vi.mock('@/lib/items/read', () => ({ getItem: vi.fn() }))
vi.mock('@/lib/items/write', () => ({ upsertMemo: vi.fn() }))
vi.mock('@/lib/git/notesRepo', () => ({
  commitNote: vi.fn(),
  noteAtCommit: vi.fn(),
  noteHistory: vi.fn(),
}))
vi.mock('@/lib/git/noteHistoryBackfill', () => ({ backfillAllNotes: vi.fn() }))

const ID = '00000000-0000-7000-8000-000000000001'
const OID = 'a'.repeat(40)

function item(memo: string): Item {
  return {
    itemId: ID,
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

function historyWith(oid: string): void {
  vi.mocked(noteHistory).mockResolvedValue([
    { oid, parentOid: null, date: '2026-09-01T00:00:00+09:00', message: `update ${ID}` },
  ])
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.restoreAllMocks()
  mocks.demo = false
  vi.mocked(getItem).mockResolvedValue(null)
})

describe('commitNoteVersion', () => {
  test('DB のいまの本文を、整えた 1 行目のメッセージでコミットする', async () => {
    // Arrange
    vi.mocked(getItem).mockResolvedValue(item('DB の本文'))
    vi.mocked(commitNote).mockResolvedValue(OID)

    // Act
    const result = await commitNoteVersion(ID, ' fix\x07 typo \n2 行目')

    // Assert
    expect(result).toBe('committed')
    expect(commitNote).toHaveBeenCalledWith(ID, 'DB の本文', 'fix typo')
  })

  test('メッセージが空なら既定文言、変化なしなら noop', async () => {
    vi.mocked(getItem).mockResolvedValue(item('いまの本文'))
    vi.mocked(commitNote).mockResolvedValue(null)

    const result = await commitNoteVersion(ID, '\x1b ')

    expect(result).toBe('noop')
    expect(commitNote).toHaveBeenCalledWith(ID, 'いまの本文', `update ${ID}`)
  })

  test('ノートが無ければ 404 で投げ、コミットしない', async () => {
    await expect(commitNoteVersion(ID, 'msg')).rejects.toMatchObject({
      status: 404,
      message: 'ノートが見つかりません',
    })
    expect(commitNote).not.toHaveBeenCalled()
  })
})

describe('restoreNoteVersion', () => {
  test('消える版を刻んでから過去の本文を保存経路で書き戻す', async () => {
    historyWith(OID)
    vi.mocked(noteAtCommit).mockResolvedValue('過去の本文')
    vi.mocked(getItem).mockResolvedValue(item('いまの本文'))
    const restored = item('過去の本文')
    vi.mocked(upsertMemo).mockResolvedValue(restored)

    const result = await restoreNoteVersion(ID, OID)

    expect(result).toBe(restored)
    expect(noteAtCommit).toHaveBeenCalledWith(ID, OID)
    expect(commitNote).toHaveBeenCalledWith(ID, 'いまの本文', `conflict ${ID}`)
    expect(upsertMemo).toHaveBeenCalledWith(ID, '過去の本文')
    expect(vi.mocked(commitNote).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(upsertMemo).mock.invocationCallOrder[0],
    )
  })

  test('デモでは刻まずに書き戻す', async () => {
    mocks.demo = true
    historyWith(OID)
    vi.mocked(noteAtCommit).mockResolvedValue('過去の本文')
    vi.mocked(getItem).mockResolvedValue(item('いまの本文'))

    await restoreNoteVersion(ID, OID)

    expect(commitNote).not.toHaveBeenCalled()
    expect(upsertMemo).toHaveBeenCalledWith(ID, '過去の本文')
  })

  test('oid の書式が不正なら 400 で、履歴を引かない', async () => {
    await expect(restoreNoteVersion(ID, 'HEAD')).rejects.toMatchObject({
      status: 400,
      message: 'コミット oid が不正です',
    })
    expect(noteHistory).not.toHaveBeenCalled()
  })

  test('このノートの履歴に無い oid は 404', async () => {
    historyWith('b'.repeat(40))

    await expect(restoreNoteVersion(ID, OID)).rejects.toMatchObject({
      status: 404,
      message: 'このノートの履歴にないコミットです',
    })
    expect(noteAtCommit).not.toHaveBeenCalled()
  })

  test('その版に本文が無ければ 404', async () => {
    historyWith(OID)
    vi.mocked(noteAtCommit).mockResolvedValue(null)

    await expect(restoreNoteVersion(ID, OID)).rejects.toMatchObject({
      status: 404,
      message: 'この版にノートの本文がありません',
    })
    expect(upsertMemo).not.toHaveBeenCalled()
  })

  test('いまの本文を刻めなければ 500 で、復元しない', async () => {
    historyWith(OID)
    vi.mocked(noteAtCommit).mockResolvedValue('過去の本文')
    vi.mocked(getItem).mockResolvedValue(item('いまの本文'))
    vi.mocked(commitNote).mockRejectedValue(new Error('git が壊れた'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(restoreNoteVersion(ID, OID)).rejects.toMatchObject({
      status: 500,
      message: 'いまの本文を履歴に残せませんでした。復元していません',
    })
    expect(upsertMemo).not.toHaveBeenCalled()
  })
})

describe('backfillHistory', () => {
  test.each([
    [OID, 'imported'],
    [null, 'noop'],
  ] as const)('取り込みの結果 (oid=%s) を %s で返す', async (oid, expected) => {
    vi.mocked(backfillAllNotes).mockResolvedValue({ count: 3, oid })

    expect(await backfillHistory()).toBe(expected)
  })
})
