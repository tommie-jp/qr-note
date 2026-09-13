import { expect, test } from 'vitest'
import { errorText } from './errorMessage'

test('Error なら message を返す (fallback は使わない)', () => {
  // Arrange
  const error = new TypeError('壊れた')

  // Act
  const text = errorText(error, '失敗しました')

  // Assert
  expect(text).toBe('壊れた')
})

test('Error 以外なら fallback を返す', () => {
  // Arrange
  const thrown = { reason: 'x' }

  // Act
  const text = errorText(thrown, '失敗しました')

  // Assert
  expect(text).toBe('失敗しました')
})

test('fallback を省くと、Error 以外の値は String() したものを返す', () => {
  // Arrange
  const thrown = 'ただの文字列'

  // Act
  const text = errorText(thrown)

  // Assert
  expect(text).toBe('ただの文字列')
  expect(errorText(undefined)).toBe('undefined')
  expect(errorText(404)).toBe('404')
})

test('message が空の Error は空文字のまま返す (fallback へ倒さない)', () => {
  // Arrange
  const error = new Error('')

  // Act
  const text = errorText(error, '失敗しました')

  // Assert
  expect(text).toBe('')
})

test('fallback が空文字なら、String() ではなく空文字を返す', () => {
  // Arrange / Act
  const text = errorText(null, '')

  // Assert
  expect(text).toBe('')
})

test('DOMException も Error として message を返す', () => {
  // Arrange
  const error = new DOMException('許可されませんでした', 'NotAllowedError')

  // Act
  const text = errorText(error, '失敗しました')

  // Assert
  expect(text).toBe('許可されませんでした')
})
