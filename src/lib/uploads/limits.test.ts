import { afterEach, expect, test } from 'vitest'
import {
  DEMO_MAX_IMAGE_BYTES,
  maxAttachmentBytes,
  MAX_IMAGE_BYTES,
  maxUploadBytes,
  MAX_VIDEO_ANIM_FRAME_BYTES,
  MAX_VIDEO_ANIM_FRAMES,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_THUMB_BYTES,
  MULTIPART_OVERHEAD_BYTES,
} from './limits'

const originalDemo = process.env.DEMO_MODE

afterEach(() => {
  if (originalDemo === undefined) {
    delete process.env.DEMO_MODE
  } else {
    process.env.DEMO_MODE = originalDemo
  }
})

test('サイズ上限は 10MB', () => {
  expect(MAX_IMAGE_BYTES).toBe(10 * 1024 * 1024)
})

// docs/38-デモモード計画.md §5。デモは 1 ファイルを 2MB に縮める
// maxUploadBytes はリクエストの「門」= 全種別の最大 (動画 30MB)。デモは 2MB。
// 種別ごとの上限は maxAttachmentBytes (動画以外 10MB) が別に持つ。
test('maxUploadBytes は通常 30MB (動画枠) / デモは 2MB', () => {
  delete process.env.DEMO_MODE
  expect(maxUploadBytes()).toBe(MAX_VIDEO_BYTES)
  expect(maxAttachmentBytes()).toBe(MAX_IMAGE_BYTES)

  process.env.DEMO_MODE = '1'
  expect(maxUploadBytes()).toBe(DEMO_MAX_IMAGE_BYTES)
  expect(maxAttachmentBytes()).toBe(DEMO_MAX_IMAGE_BYTES)
  expect(DEMO_MAX_IMAGE_BYTES).toBe(2 * 1024 * 1024)
})

test('コマの合計は multipart のオーバーヘッド枠に収まる', () => {
  // 動画本体の上限 + MULTIPART_OVERHEAD_BYTES が checkUploadRequest の門なので、
  // poster とコマの合計がこの枠を超えると、動画そのものが 413 で断られる。
  // 上限を触るときに気づけるよう関係を式で残す
  const extras =
    MAX_VIDEO_THUMB_BYTES + MAX_VIDEO_ANIM_FRAMES * MAX_VIDEO_ANIM_FRAME_BYTES

  expect(extras).toBeLessThan(MULTIPART_OVERHEAD_BYTES)
})

test('動画の上限は画像より大きい (41-QR-search/docs/14: 3 分 720p を収める)', () => {
  // 3 分・映像 1Mbps + 音声 64kbps ≈ 24MB が収まること
  const estimatedThreeMin = ((1_000_000 + 64_000) / 8) * 180
  expect(estimatedThreeMin).toBeLessThan(MAX_VIDEO_BYTES)
})
