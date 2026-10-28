import { describe, expect, test } from 'vitest'
import { FOLDER_TAG_MIN_COUNT, folderTags } from './folderTags'

const tag = (name: string, count: number) => ({ tag: name, count })

describe('folderTags', () => {
  test('2 ノート以上に付いたタグだけを残す', () => {
    const { shown, hidden } = folderTags([tag('電験三種', 30), tag('npn', 2), tag('単発', 1)])

    expect(shown.map((t) => t.tag)).toEqual(['電験三種', 'npn'])
    expect(hidden).toBe(1)
  })

  test('数字だけのタグ (旧番号) は件数が多くても落とす', () => {
    const { shown, hidden } = folderTags([tag('1003', 5), tag('2024', 9), tag('回路', 3)])

    expect(shown.map((t) => t.tag)).toEqual(['回路'])
    expect(hidden).toBe(2)
  })

  test('全角の数字だけのタグも落とす', () => {
    const { shown } = folderTags([tag('１００３', 5), tag('R1', 4)])

    expect(shown.map((t) => t.tag)).toEqual(['R1'])
  })

  test('数字を含んでいても数字だけでなければ残す', () => {
    const { shown } = folderTags([tag('2SC1815', 2), tag('74HC', 2)])

    expect(shown).toHaveLength(2)
  })

  test('並びは入力のまま (件数の多い順を呼び出し側が決める)', () => {
    const { shown } = folderTags([tag('b', 9), tag('a', 3), tag('c', 3)])

    expect(shown.map((t) => t.tag)).toEqual(['b', 'a', 'c'])
  })

  test('絞る物が無ければ hidden は 0', () => {
    expect(folderTags([tag('a', 2)]).hidden).toBe(0)
    expect(folderTags([]).hidden).toBe(0)
  })

  test('閾値は 2', () => {
    expect(FOLDER_TAG_MIN_COUNT).toBe(2)
  })
})
