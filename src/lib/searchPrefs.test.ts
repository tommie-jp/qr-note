import { expect, test } from 'vitest'
import { readSearchPrefs, readTrashPrefs, type CookieReader } from './searchPrefs'

// cookies() の代わり。get だけを持つ素のオブジェクト
const cookieStoreOf = (values: Record<string, string>): CookieReader => ({
  get: (name) => (name in values ? { value: values[name] } : undefined),
})

test('検索一覧は cookie が無ければ 更新順・小・2 ペイン', () => {
  // Arrange
  const cookieStore = cookieStoreOf({})

  // Act
  const prefs = readSearchPrefs(cookieStore, undefined)

  // Assert
  expect(prefs).toEqual({ sort: 'updated', view: 'compact', paneMode: '2' })
})

test('検索一覧は並び順・表示モード・ペイン構成を cookie から読む', () => {
  // Arrange
  const cookieStore = cookieStoreOf({ sort: 'accessed', view: 'card', panes: '3' })

  // Act
  const prefs = readSearchPrefs(cookieStore, undefined)

  // Assert
  expect(prefs).toEqual({ sort: 'accessed', view: 'card', paneMode: '3' })
})

// 共有されたリンクを開いた人に、自分の好みを混ぜて見せない (sortMode.ts)
test('検索一覧の並び順は URL の指定を cookie より優先する', () => {
  // Arrange
  const cookieStore = cookieStoreOf({ sort: 'accessed' })

  // Act
  const prefs = readSearchPrefs(cookieStore, 'itemNo')

  // Assert
  expect(prefs.sort).toBe('itemNo')
})

// cookie は利用者が自由に書き換えられる外部入力
test('検索一覧の知らない cookie の値は既定へ倒す', () => {
  // Arrange
  const cookieStore = cookieStoreOf({ sort: 'x', view: 'huge', panes: '9' })

  // Act
  const prefs = readSearchPrefs(cookieStore, undefined)

  // Assert
  expect(prefs).toEqual({ sort: 'updated', view: 'compact', paneMode: '2' })
})

test('ゴミ箱は cookie が無ければ削除順・小', () => {
  // Arrange
  const cookieStore = cookieStoreOf({})

  // Act
  const prefs = readTrashPrefs(cookieStore, undefined)

  // Assert
  expect(prefs).toEqual({ sort: 'deleted', view: 'compact' })
})

// 並び順の cookie は検索一覧と分ける (docs/67 §2)。表示形式だけ共有する
test('ゴミ箱は並び順をゴミ箱用の cookie から、表示形式を検索一覧と同じ cookie から読む', () => {
  // Arrange
  const cookieStore = cookieStoreOf({
    sort: 'accessed',
    trashSort: 'deletedAsc',
    view: 'image',
  })

  // Act
  const prefs = readTrashPrefs(cookieStore, undefined)

  // Assert
  expect(prefs).toEqual({ sort: 'deletedAsc', view: 'image' })
})

test('ゴミ箱の並び順も URL の指定を cookie より優先する', () => {
  // Arrange
  const cookieStore = cookieStoreOf({ trashSort: 'deletedAsc' })

  // Act
  const prefs = readTrashPrefs(cookieStore, 'itemNo')

  // Assert
  expect(prefs.sort).toBe('itemNo')
})
