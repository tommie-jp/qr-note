import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Item } from '@/generated/prisma/client'
import { renderCircuits } from '@/lib/circuit/cache'
import { commitNote } from '@/lib/git/notesRepo'
import { recordMeasurement } from '@/lib/health/healthEdit'
import { recordItemAccess, setItemPublic } from '@/lib/items/flags'
import { nextFreeNoteNumber } from '@/lib/items/noteNumber.server'
import { getItem } from '@/lib/items/read'
import { modifyMemo, saveItemIfUnchanged } from '@/lib/items/write'
import { differsOnlyInTaskMarks } from '@/lib/markdown/taskCheckbox'
import { MAX_TEXT_LENGTH } from '@/lib/validation'
import { CommandError } from './commandError'
import {
  assignNoteNumber,
  recordAccess,
  recordHealth,
  saveNote,
  setNotePublic,
  toggleTask,
} from './noteCommands'

// ノート 1 件を書き換える本体 (docs/123 §2-1)。もとは Server Action の
// 直接テスト (app/actions.test.ts) が押さえていた「書く・書かない・刻む・
// 描き直させる」の組み合わせを、門番を外した本体の側で押さえ直す。
//
// 差し替えるのは Next の口 (revalidatePath / after)、環境、DB と git と
// 回路図に触る層だけ。本文の書き換え (taskCheckbox・tags・healthEdit) と
// 競合の形 (saveState) は本物を通す
const mocks = vi.hoisted(() => ({
  demo: false,
  afterTasks: [] as Array<() => Promise<void>>,
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => Promise<void>) => {
    mocks.afterTasks.push(task)
  },
}))
vi.mock('@/lib/appEnv', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/appEnv')>()),
  isDemoMode: () => mocks.demo,
}))
vi.mock('@/lib/items/read', () => ({ getItem: vi.fn() }))
vi.mock('@/lib/items/noteNumber.server', () => ({ nextFreeNoteNumber: vi.fn() }))
vi.mock('@/lib/items/write', () => ({ modifyMemo: vi.fn(), saveItemIfUnchanged: vi.fn() }))
vi.mock('@/lib/items/flags', () => ({ recordItemAccess: vi.fn(), setItemPublic: vi.fn() }))
vi.mock('@/lib/git/notesRepo', () => ({ commitNote: vi.fn() }))
vi.mock('@/lib/circuit/cache', () => ({ renderCircuits: vi.fn() }))

const ID = '00000000-0000-7000-8000-000000000001'
const NOW = 1_757_808_000_000
const BASE = { kind: 'at', at: new Date(2_000) } as const

function item(overrides: Partial<Item> = {}): Item {
  return {
    itemId: ID,
    memo: 'いまの本文',
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

function revalidated(): string[] {
  return mocks.revalidatePath.mock.calls.map(([path]) => path as string)
}

// modifyMemo の代わりに、渡された書き換えを本文に当てた結果を覚える
function applyTransformTo(memo: string): { written: () => string | null } {
  let written: string | null = null
  vi.mocked(modifyMemo).mockImplementation(async (_id, transform) => {
    const next = await transform(memo)
    written = next
    return next === memo ? 'unchanged' : 'saved'
  })
  return { written: () => written }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.demo = false
  mocks.afterTasks = []
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  vi.mocked(getItem).mockResolvedValue(null)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('saveNote', () => {
  test('基点が同じなら保存し、図を後で描く予約をして公開ビューを描き直させる', async () => {
    // Arrange
    const saved = item({ memo: '新しい本文' })
    vi.mocked(saveItemIfUnchanged).mockResolvedValue({ ok: true, item: saved })

    // Act
    const result = await saveNote(ID, '新しい本文', BASE, false)

    // Assert
    expect(result).toStrictEqual({ ok: true, item: saved })
    expect(saveItemIfUnchanged).toHaveBeenCalledWith(ID, { memo: '新しい本文' }, BASE)
    expect(revalidated()).toEqual([`/item/${ID}`])
    expect(mocks.afterTasks).toHaveLength(1)
    expect(commitNote).not.toHaveBeenCalled()
  })

  test('応答後の図の描画は保存した本文で走り、失敗しても投げない', async () => {
    vi.mocked(saveItemIfUnchanged).mockResolvedValue({ ok: true, item: item() })
    vi.mocked(renderCircuits).mockRejectedValue(new Error('TeX error'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await saveNote(ID, '新しい本文', BASE, false)

    await mocks.afterTasks[0]()

    expect(renderCircuits).toHaveBeenCalledWith('新しい本文')
    expect(warn).toHaveBeenCalledWith(`保存後の回路図を描けませんでした (${ID})`, expect.any(Error))
  })

  test('基点がずれていたら書かずに競合といまの版を返す (描き直しも予約もしない)', async () => {
    const current = item({ memo: '別の端末の本文', updatedAt: new Date(3_000) })
    vi.mocked(saveItemIfUnchanged).mockResolvedValue({ ok: false, reason: 'conflict', current })

    const result = await saveNote(ID, '新しい本文', BASE, false)

    expect(result).toStrictEqual({
      ok: false,
      state: {
        seq: NOW,
        kind: 'conflict',
        server: { memo: '別の端末の本文', updatedAt: 3_000, deletedAt: null },
      },
    })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
    expect(mocks.afterTasks).toEqual([])
  })

  test('新規のはずが行があれば exists といまの版を返す', async () => {
    vi.mocked(saveItemIfUnchanged).mockResolvedValue({
      ok: false,
      reason: 'exists',
      current: item({ memo: '古い本文' }),
    })

    const result = await saveNote(ID, '本文', { kind: 'new' }, false)

    expect(result).toStrictEqual({
      ok: false,
      state: {
        seq: NOW,
        kind: 'exists',
        server: { memo: '古い本文', updatedAt: 2_000, deletedAt: null },
      },
    })
  })

  test('編集中に永久削除されていたら server は null', async () => {
    vi.mocked(saveItemIfUnchanged).mockResolvedValue({ ok: false, reason: 'missing' })

    const result = await saveNote(ID, '新しい本文', BASE, false)

    expect(result).toStrictEqual({ ok: false, state: { seq: NOW, kind: 'missing', server: null } })
  })

  test('「このまま上書き」は消える版を先に刻んでから保存する', async () => {
    vi.mocked(getItem).mockResolvedValue(item({ memo: '消える版' }))
    vi.mocked(saveItemIfUnchanged).mockResolvedValue({ ok: true, item: item() })

    await saveNote(ID, '新しい本文', BASE, true)

    expect(commitNote).toHaveBeenCalledWith(ID, '消える版', `conflict ${ID}`)
    expect(vi.mocked(commitNote).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(saveItemIfUnchanged).mock.invocationCallOrder[0],
    )
  })

  test('いまの版と同じ本文なら刻まずに保存する', async () => {
    vi.mocked(getItem).mockResolvedValue(item({ memo: '新しい本文' }))
    vi.mocked(saveItemIfUnchanged).mockResolvedValue({ ok: true, item: item() })

    await saveNote(ID, '新しい本文', BASE, true)

    expect(commitNote).not.toHaveBeenCalled()
    expect(saveItemIfUnchanged).toHaveBeenCalled()
  })

  test('デモでは刻まずに保存する (履歴機能ごと閉じている)', async () => {
    mocks.demo = true
    vi.mocked(getItem).mockResolvedValue(item({ memo: '消える版' }))
    vi.mocked(saveItemIfUnchanged).mockResolvedValue({ ok: true, item: item() })

    await saveNote(ID, '新しい本文', BASE, true)

    expect(commitNote).not.toHaveBeenCalled()
    expect(saveItemIfUnchanged).toHaveBeenCalled()
  })

  test('刻めなければ上書きせず checkpointFailed といまの版を返す', async () => {
    vi.mocked(getItem).mockResolvedValue(item({ memo: '消える版' }))
    vi.mocked(commitNote).mockRejectedValue(new Error('git が壊れた'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await saveNote(ID, '新しい本文', BASE, true)

    expect(result).toStrictEqual({
      ok: false,
      state: {
        seq: NOW,
        kind: 'checkpointFailed',
        server: { memo: '消える版', updatedAt: 2_000, deletedAt: null },
      },
    })
    expect(saveItemIfUnchanged).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(
      `競合チェックポイントのコミットに失敗しました (${ID})`,
      expect.any(Error),
    )
  })
})

describe('toggleTask', () => {
  test('行番号を検算しながら書き換え、書き終えたノートを返す', async () => {
    vi.mocked(modifyMemo).mockResolvedValue('saved')
    const after = item({ memo: '# 単語\n- [x] apple' })
    vi.mocked(getItem).mockResolvedValue(after)

    const result = await toggleTask(ID, 2, true)

    const [itemId, transform, options] = vi.mocked(modifyMemo).mock.calls[0]
    expect(itemId).toBe(ID)
    expect(transform('# 単語\n- [ ] apple')).toBe('# 単語\n- [x] apple')
    expect(transform('# 単語\n本文')).toBeNull()
    expect(options).toStrictEqual({ canRetry: differsOnlyInTaskMarks })
    expect(result).toBe(after)
    expect(revalidated()).toEqual([`/item/${ID}`])
  })

  test.each([
    ['missing', 404, 'ノートが見つかりません'],
    ['rejected', 409, '本文が変わっています。画面を更新してください'],
  ] as const)('%s なら描き直させずに %i で投げる', async (outcome, status, message) => {
    vi.mocked(modifyMemo).mockResolvedValue(outcome)

    const error = await toggleTask(ID, 1, true).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(CommandError)
    expect(error).toMatchObject({ status, message })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  test('書いた後に消えていたら 404 で投げる', async () => {
    vi.mocked(modifyMemo).mockResolvedValue('saved')

    await expect(toggleTask(ID, 1, true)).rejects.toMatchObject({ status: 404 })
  })
})

describe('recordHealth', () => {
  const entry = { date: '2026-09-14', item: '体重', values: [66.4], unit: 'kg' }

  test('記録を書き込み、描き直させる (当て直しの門番は渡さない)', async () => {
    vi.mocked(modifyMemo).mockResolvedValue('saved')
    vi.mocked(getItem).mockResolvedValue(item())

    await recordHealth(ID, entry)

    const [itemId, transform, options] = vi.mocked(modifyMemo).mock.calls[0]
    expect(itemId).toBe(ID)
    expect(options).toBeUndefined()
    expect(transform('# 体重\n')).toBe(recordMeasurement('# 体重\n', entry))
    expect(revalidated()).toEqual([`/item/${ID}`])
  })

  test('書き込んだ本文が上限を超えるなら 400 で投げる', async () => {
    vi.mocked(modifyMemo).mockResolvedValue('saved')
    vi.mocked(getItem).mockResolvedValue(item())
    await recordHealth(ID, entry)
    const transform = vi.mocked(modifyMemo).mock.calls[0][1]

    expect(() => transform('あ'.repeat(MAX_TEXT_LENGTH))).toThrow(
      new CommandError(400, `本文が長すぎます (最大 ${MAX_TEXT_LENGTH} 文字)`),
    )
  })

  test.each([
    ['missing', 404, 'ノートが見つかりません'],
    ['rejected', 400, 'この値は記録できません'],
  ] as const)('%s なら描き直させずに %i で投げる', async (outcome, status, message) => {
    vi.mocked(modifyMemo).mockResolvedValue(outcome)

    await expect(recordHealth(ID, entry)).rejects.toMatchObject({ status, message })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})

describe('recordAccess', () => {
  test('開いた日時を記録する', async () => {
    await recordAccess(ID)

    expect(recordItemAccess).toHaveBeenCalledWith(ID)
  })

  test('記録に失敗しても投げない', async () => {
    vi.mocked(recordItemAccess).mockRejectedValue(new Error('DB が落ちた'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(recordAccess(ID)).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledWith(
      `アクセス日時を記録できませんでした (${ID}):`,
      expect.any(Error),
    )
  })
})

describe('assignNoteNumber (docs/111)', () => {
  test('番号の無いノートに空き番号のタグを足し、描き直させる', async () => {
    vi.mocked(getItem).mockResolvedValue(item({ memo: '抵抗 10k', tags: [] }))
    vi.mocked(nextFreeNoteNumber).mockResolvedValue('1471')
    const run = applyTransformTo('抵抗 10k')

    await assignNoteNumber(ID)

    expect(run.written()).toBe('抵抗 10k\n#1471')
    expect(revalidated()).toEqual([`/item/${ID}`])
  })

  test('番号が既にあれば何も書かずにそのノートを返す', async () => {
    const numbered = item({ memo: '#1003', tags: ['1003'] })
    vi.mocked(getItem).mockResolvedValue(numbered)

    const result = await assignNoteNumber(ID)

    expect(result).toBe(numbered)
    expect(nextFreeNoteNumber).not.toHaveBeenCalled()
    expect(modifyMemo).not.toHaveBeenCalled()
  })

  test('番号が 2 つあっても 3 つ目は足さない', async () => {
    vi.mocked(getItem).mockResolvedValue(item({ tags: ['1003', '2026'] }))

    await assignNoteNumber(ID)

    expect(modifyMemo).not.toHaveBeenCalled()
  })

  test('読んでから書くまでに番号が付いていれば、二重に足さない', async () => {
    vi.mocked(getItem).mockResolvedValue(item({ memo: '本文', tags: [] }))
    vi.mocked(nextFreeNoteNumber).mockResolvedValue('1471')
    // 別の端末が先に #1500 を振った本文に当たる
    const run = applyTransformTo('本文\n#1500')

    await assignNoteNumber(ID)

    expect(run.written()).toBe('本文\n#1500')
  })

  test('空き番号が尽きていれば 409 で断る', async () => {
    vi.mocked(getItem).mockResolvedValue(item({ tags: [] }))
    vi.mocked(nextFreeNoteNumber).mockResolvedValue(null)

    await expect(assignNoteNumber(ID)).rejects.toMatchObject({
      status: 409,
      message: '空き番号がありません (1000〜9999)',
    })
    expect(modifyMemo).not.toHaveBeenCalled()
  })

  test('ノートが無ければ 404 で断る', async () => {
    await expect(assignNoteNumber(ID)).rejects.toMatchObject({
      status: 404,
      message: 'ノートが見つかりません',
    })
  })

  test('書く間に消えていたら 404 で断る', async () => {
    vi.mocked(getItem).mockResolvedValue(item({ tags: [] }))
    vi.mocked(nextFreeNoteNumber).mockResolvedValue('1471')
    vi.mocked(modifyMemo).mockResolvedValue('missing')

    await expect(assignNoteNumber(ID)).rejects.toMatchObject({ status: 404 })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})

describe('setNotePublic', () => {
  test.each([true, false])('望む状態 (%s) をそのまま書き、描き直させる', async (isPublic) => {
    const after = item({ publicAt: isPublic ? new Date(5_000) : null })
    vi.mocked(getItem).mockResolvedValue(after)

    const result = await setNotePublic(ID, isPublic)

    expect(setItemPublic).toHaveBeenCalledWith(ID, isPublic)
    expect(revalidated()).toEqual([`/item/${ID}`])
    expect(result).toBe(after)
  })
})
