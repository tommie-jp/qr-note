import { expect, test } from 'vitest'
import { MAX_VIDEO_ANIM_FRAME_BYTES, MAX_VIDEO_THUMB_BYTES } from '../limits'
import {
  ftypBox,
  JPEG_HEAD,
  mp4WithHandlers,
  PNG_HEAD,
  webmFile,
} from './__fixtures__/media'
import { sniffAudioFormat } from './audio'
import {
  isValidVideoAnimFrame,
  isValidVideoThumb,
  sniffVideoFormat,
  videoSaveInfo,
} from './video'

// --- 動画 (41-QR-search/docs/14-動画挿入計画.md) ---

test('webm は映像 CodecID があれば動画と判定する (音声判定の裏返し)', () => {
  // 映像のみ・映像+音声のどちらも動画
  expect(sniffVideoFormat(webmFile(['V_VP9']))).toBe('webm')
  expect(sniffVideoFormat(webmFile(['V_VP9', 'A_OPUS']))).toBe('webm')
  expect(sniffVideoFormat(webmFile(['V_VP8', 'A_OPUS']))).toBe('webm')
  expect(sniffVideoFormat(webmFile(['V_AV1']))).toBe('webm')
  // 音声のみ webm は動画ではない (sniffAudioFormat が拾う)
  expect(sniffVideoFormat(webmFile(['A_OPUS']))).toBeNull()
  // EBML マジックだけでは動画と判らない
  expect(sniffVideoFormat(webmFile([]))).toBeNull()
})

test('mp4/mov は moov に映像トラックがあれば動画と判定する', () => {
  // 一般的な mp4 (映像+音声)
  expect(sniffVideoFormat(mp4WithHandlers('isom', ['vide', 'soun']))).toBe('mp4')
  expect(sniffVideoFormat(mp4WithHandlers('mp42', ['vide']))).toBe('mp4')
  // Safari の録画は iso5 系ブランドでも映像トラックで拾える
  expect(sniffVideoFormat(mp4WithHandlers('iso5', ['vide', 'soun']))).toBe('mp4')
  // QuickTime (.mov) は major brand "qt  " で mov に振り分ける
  expect(sniffVideoFormat(mp4WithHandlers('qt  ', ['vide', 'soun']))).toBe('mov')
})

test('音声のみ・画像・空は動画として受けない', () => {
  // 音声のみの mp4 (soun だけ) は動画ではない
  expect(sniffVideoFormat(mp4WithHandlers('mp42', ['soun']))).toBeNull()
  // iPhone ボイスメモ (M4A ブランド・moov 無し) も動画ではない
  expect(sniffVideoFormat(ftypBox('M4A ', ['M4A ']))).toBeNull()
  expect(sniffVideoFormat(PNG_HEAD)).toBeNull()
  expect(sniffVideoFormat(new TextEncoder().encode('%PDF-1.7'))).toBeNull()
  expect(sniffVideoFormat(new Uint8Array(0))).toBeNull()
})

test('動画と音声の判定は互いに混ざらない', () => {
  // 音声のみは音声、映像入りは動画。両方が同じファイルを拾わない
  const audioWebm = webmFile(['A_OPUS'])
  expect(sniffAudioFormat(audioWebm)).toBe('webm')
  expect(sniffVideoFormat(audioWebm)).toBeNull()

  const videoWebm = webmFile(['V_VP9', 'A_OPUS'])
  expect(sniffAudioFormat(videoWebm)).toBeNull()
  expect(sniffVideoFormat(videoWebm)).toBe('webm')
})

// webm 動画の保存拡張子は `.mkv` (音声のみの .webm と URL 上で衝突させない。
// video/videoFormats.ts の経緯)。中身の形式 'webm' → 保存 ext 'mkv' に写す。
test('動画形式を保存用の mime / ext に写す (webm 動画は .mkv)', () => {
  expect(videoSaveInfo('mp4')).toEqual({ mime: 'video/mp4', ext: 'mp4' })
  expect(videoSaveInfo('webm')).toEqual({ mime: 'video/webm', ext: 'mkv' })
  expect(videoSaveInfo('mov')).toEqual({ mime: 'video/quicktime', ext: 'mov' })
})

test('動画のクライアントサムネは sharp が読める画像かつ 200KB 以下を受ける', () => {
  const webp = new TextEncoder().encode('RIFF\0\0\0\0WEBP')
  expect(isValidVideoThumb(webp)).toBe(true)
  // JPEG・PNG も受ける (Safari は canvas で webp を出せないので JPEG に化ける。
  // サーバが sharp で webp へ作り直す)
  expect(isValidVideoThumb(JPEG_HEAD)).toBe(true)
  expect(isValidVideoThumb(PNG_HEAD)).toBe(true)
  // 画像でないもの (HTML/SVG) は拒否 (sniffImageFormat が null を返す)
  expect(isValidVideoThumb(new TextEncoder().encode('<svg onload=alert(1)>'))).toBe(false)
  // 空も拒否
  expect(isValidVideoThumb(new Uint8Array(0))).toBe(false)
  // 上限超過は拒否 (先頭は正しい WebP 署名でも大きさで弾く)
  const huge = new Uint8Array(MAX_VIDEO_THUMB_BYTES + 1)
  huge.set(webp, 0)
  expect(isValidVideoThumb(huge)).toBe(false)
})

test('動くサムネのコマは静止サムネより厳しい上限で受ける', () => {
  // 判定の考え方は poster と同じ (中身で決める) で、上限だけが違う。
  // コマは枚数ぶん積み上がるので 1 枚あたりを絞る
  expect(isValidVideoAnimFrame(JPEG_HEAD)).toBe(true)
  expect(isValidVideoAnimFrame(PNG_HEAD)).toBe(true)
  expect(
    isValidVideoAnimFrame(new TextEncoder().encode('<svg onload=alert(1)>')),
  ).toBe(false)
  expect(isValidVideoAnimFrame(new Uint8Array(0))).toBe(false)

  const huge = new Uint8Array(MAX_VIDEO_ANIM_FRAME_BYTES + 1)
  huge.set(JPEG_HEAD, 0)
  expect(isValidVideoAnimFrame(huge)).toBe(false)
})
