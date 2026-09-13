import { expect, test } from 'vitest'
import { AUDIO_EXTENSION_ALTERNATION, AUDIO_EXTENSIONS } from './audioFormats'
import { defineFormats } from './defineFormats'
import { TEXT_EXTENSION_ALTERNATION, TEXT_EXTENSIONS } from './textFormats'
import { VIDEO_EXTENSION_ALTERNATION, VIDEO_EXTENSIONS } from './videoFormats'

test('一覧をそのまま返し、選択肢は | でつなぐ', () => {
  // Arrange
  const list = ['a', 'b1', 'c'] as const

  // Act
  const formats = defineFormats(list)

  // Assert
  expect(formats.list).toBe(list)
  expect(formats.alternation).toBe('a|b1|c')
})

test('1 つだけなら選択肢は区切りを持たない', () => {
  expect(defineFormats(['pdf'] as const).alternation).toBe('pdf')
})

test('音声・動画・テキストの一覧と選択肢は並びどおり', () => {
  expect(AUDIO_EXTENSIONS).toEqual(['mp3', 'm4a', 'wav', 'webm'])
  expect(AUDIO_EXTENSION_ALTERNATION).toBe('mp3|m4a|wav|webm')
  expect(VIDEO_EXTENSIONS).toEqual(['mp4', 'mkv', 'mov'])
  expect(VIDEO_EXTENSION_ALTERNATION).toBe('mp4|mkv|mov')
  expect(TEXT_EXTENSIONS).toEqual(['txt', 'csv', 'md'])
  expect(TEXT_EXTENSION_ALTERNATION).toBe('txt|csv|md')
})
