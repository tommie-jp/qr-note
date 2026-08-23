import { expect, test } from 'vitest'
import { noteSnapshot } from './saveState'

test('サーバの版は画面が要る分だけに絞る (日時はミリ秒で渡す)', () => {
  // Arrange
  const item = {
    memo: '相手の版',
    url: 'https://example.com/',
    mode: 'memo' as const,
    updatedAt: new Date(1_787_000_000_123),
    deletedAt: null,
  }

  // Act
  const snapshot = noteSnapshot(item)

  // Assert — updatedAt はそのまま次の基点になる (formatBase と同じ土俵)
  expect(snapshot).toEqual({
    memo: '相手の版',
    url: 'https://example.com/',
    mode: 'memo',
    updatedAt: 1_787_000_000_123,
    deletedAt: null,
  })
})

test('ゴミ箱の行はその印も渡す (バナーで言い添える)', () => {
  const snapshot = noteSnapshot({
    memo: '',
    url: '',
    mode: 'memo',
    updatedAt: new Date(1_787_000_000_123),
    deletedAt: new Date(1_787_000_000_000),
  })

  expect(snapshot.deletedAt).toBe(1_787_000_000_000)
})
