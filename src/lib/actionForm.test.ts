import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Item } from '@/generated/prisma/client'
import { conflictState, readBase, readItemNo, readText } from './actionForm'
import { MAX_TEXT_LENGTH } from './validation'

function formWith(key: string, value: string | Blob): FormData {
  const formData = new FormData()
  formData.append(key, value)
  return formData
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('readText', () => {
  test('文字列の値をそのまま返す', () => {
    expect(readText(formWith('memo', '  本文\n'), 'memo')).toBe('  本文\n')
  })

  test('項目が無ければ空文字', () => {
    expect(readText(new FormData(), 'memo')).toBe('')
  })

  // ファイルを送りつけられても文字列として扱わない
  test('ファイルの値は空文字', () => {
    expect(readText(formWith('memo', new Blob(['本文'])), 'memo')).toBe('')
  })

  test('上限ちょうどは通す', () => {
    const text = 'あ'.repeat(MAX_TEXT_LENGTH)

    expect(readText(formWith('memo', text), 'memo')).toBe(text)
  })

  test('上限を超えたら項目名入りで投げる', () => {
    const tooLong = formWith('url', 'x'.repeat(MAX_TEXT_LENGTH + 1))

    expect(() => readText(tooLong, 'url')).toThrow(
      `url が長すぎます (最大 ${MAX_TEXT_LENGTH} 文字)`,
    )
  })
})

describe('readItemNo', () => {
  test('英数字の番号を返す', () => {
    expect(readItemNo(formWith('itemNo', '100x'))).toBe('100x')
  })

  test.each([
    ['無い', new FormData()],
    ['パス区切りを含む', formWith('itemNo', '../1')],
    ['空', formWith('itemNo', '')],
  ])('%s なら投げる', (_label, formData) => {
    expect(() => readItemNo(formData)).toThrow('itemNo が不正です')
  })
})

describe('readBase', () => {
  test.each([
    ['new', { kind: 'new' }],
    ['stale', { kind: 'stale' }],
    ['1787000000123', { kind: 'at', at: new Date(1_787_000_000_123) }],
  ])('%s を基点として読む', (raw, expected) => {
    expect(readBase(formWith('base', raw))).toEqual(expected)
  })

  // 読めない基点を「新規」や「いまの版」に丸めると、上書きを素通しする
  test.each([
    ['無い', new FormData()],
    ['数字でない', formWith('base', 'latest')],
    ['空', formWith('base', '')],
  ])('%s なら投げる', (_label, formData) => {
    expect(() => readBase(formData)).toThrow('保存の基点が不正です')
  })
})

describe('conflictState', () => {
  const current: Item = {
    itemNo: '1',
    itemNoNum: 1,
    memo: '別の端末の本文',
    url: 'https://example.com',
    mode: 'url',
    title: '',
    tags: ['英単語'],
    props: [],
    taskTodo: 1,
    taskDone: 0,
    createdAt: new Date(1_000),
    updatedAt: new Date(3_000),
    accessedAt: new Date(3_000),
    deletedAt: new Date(4_000),
    publicAt: null,
    offlinePin: false,
  }

  test('いまの版を画面に要る分だけに畳み、時刻の印を付ける', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_757_808_000_000)

    const state = conflictState('conflict', current)

    expect(state).toStrictEqual({
      seq: 1_757_808_000_000,
      kind: 'conflict',
      server: {
        memo: '別の端末の本文',
        url: 'https://example.com',
        mode: 'url',
        updatedAt: 3_000,
        deletedAt: 4_000,
      },
    })
  })

  test('行が無ければ server は null', () => {
    vi.spyOn(Date, 'now').mockReturnValue(5)

    expect(conflictState('missing', null)).toStrictEqual({
      seq: 5,
      kind: 'missing',
      server: null,
    })
  })
})
