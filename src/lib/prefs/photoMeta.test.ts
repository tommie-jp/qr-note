import { expect, test } from 'vitest'
import { DEFAULT_PHOTO_META_MODE, isPhotoMetaMode, parsePhotoMetaMode } from './photoMeta'

test('既定は「消す」', () => {
  expect(DEFAULT_PHOTO_META_MODE).toBe('strip')
})

test('知っている 2 つの値だけを受ける', () => {
  expect(isPhotoMetaMode('strip')).toBe(true)
  expect(isPhotoMetaMode('keep')).toBe(true)
  for (const value of ['KEEP', 'remove', '', null, undefined, 1, {}]) {
    expect(isPhotoMetaMode(value)).toBe(false)
  }
})

// 読めない値で「残す」へ倒れると、利用者の知らないうちに撮影情報が残る
test('知らない値・欠落は「消す」へ畳む', () => {
  expect(parsePhotoMetaMode('keep')).toBe('keep')
  expect(parsePhotoMetaMode('strip')).toBe('strip')
  for (const value of ['yes', '', null, undefined]) {
    expect(parsePhotoMetaMode(value)).toBe('strip')
  }
})
