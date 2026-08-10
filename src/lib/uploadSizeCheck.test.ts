import { expect, test } from 'vitest'
import { uploadSizeLimit, uploadTooLargeMessage } from './uploadSizeCheck'
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } from './uploads'

function fileLike(name: string, megabytes: number): { name: string; size: number } {
  return { name, size: Math.round(megabytes * 1024 * 1024) }
}

test('動画だけは大きい上限を使う', () => {
  expect(uploadSizeLimit(true)).toBe(MAX_VIDEO_BYTES)
  expect(uploadSizeLimit(false)).toBe(MAX_IMAGE_BYTES)
})

test('上限内のファイルは何も言わない', () => {
  expect(uploadTooLargeMessage(fileLike('clip.mp4', 29), true)).toBeNull()
  expect(uploadTooLargeMessage(fileLike('photo.jpg', 9), false)).toBeNull()
})

// 上限ちょうどは通す。サーバ側 (route.ts の file.size > maxUploadBytes()) が
// 「超えたら」で断るので、境界の向きを揃えないと送る前に断ったものが
// サーバでは通る (またはその逆) というずれが出る
test('上限ちょうどは通す', () => {
  expect(uploadTooLargeMessage({ name: 'clip.mp4', size: MAX_VIDEO_BYTES }, true)).toBeNull()
  expect(uploadTooLargeMessage({ name: 'photo.jpg', size: MAX_IMAGE_BYTES }, false)).toBeNull()
})

// 「大きすぎた」と分かることが目的なので、実サイズと上限の両方を出す
test('超えたら実サイズと上限を添えて理由を返す', () => {
  expect(uploadTooLargeMessage(fileLike('clip.mp4', 42.5), true)).toBe(
    'clip.mp4 は大きすぎます (42.5MB / 上限 30MB)',
  )
  expect(uploadTooLargeMessage(fileLike('photo.jpg', 12), false)).toBe(
    'photo.jpg は大きすぎます (12.0MB / 上限 10MB)',
  )
})

// ペーストした画像や録画には名前が付かないことがある。名前の欄が空のまま
// 「 は大きすぎます」と出ると壊れて見えるので、名前なしの言い回しに倒す
test('名前が無いファイルでも文が壊れない', () => {
  expect(uploadTooLargeMessage(fileLike('', 40), true)).toBe(
    'ファイルが大きすぎます (40.0MB / 上限 30MB)',
  )
  expect(uploadTooLargeMessage(fileLike('   ', 40), true)).toBe(
    'ファイルが大きすぎます (40.0MB / 上限 30MB)',
  )
})
