import { expect, test } from 'vitest'
import {
  concatBytes,
  ftypBox,
  JPEG_HEAD,
  mp4WithHandlers,
  PNG_HEAD,
  webmFile,
} from './__fixtures__/media'
import { audioSaveInfo, sniffAudioFormat } from './audio'

// --- 音声 (41-QR-search/docs/12-添付ファイル種類拡張メモ.md) ---

test('先頭バイトから音声形式を判定する (mp3/wav/m4a)', () => {
  // mp3: ID3v2 タグ始まり
  expect(sniffAudioFormat(new TextEncoder().encode('ID3\x04\x00'))).toBe('mp3')
  // mp3: ID3 無しの生フレーム同期語 (0xFF 0xFB)
  expect(sniffAudioFormat(Uint8Array.from([0xff, 0xfb, 0x90, 0x00]))).toBe('mp3')
  // wav: RIFF....WAVE
  expect(sniffAudioFormat(new TextEncoder().encode('RIFF\0\0\0\0WAVE'))).toBe('wav')
  // m4a: ISO-BMFF の ftyp に音声ブランド (iPhone ボイスメモは "M4A ")
  expect(sniffAudioFormat(ftypBox('M4A ', ['M4A ', 'mp42', 'isom']))).toBe('m4a')
  expect(sniffAudioFormat(ftypBox('M4B ', ['M4B ']))).toBe('m4a')
})

test('音声でない・動画の ftyp は null (音声判定)', () => {
  // 画像 (PNG) は音声ではない
  expect(sniffAudioFormat(PNG_HEAD)).toBeNull()
  // JPEG (FF D8) は mp3 の同期語 (FF E0 マスク) と衝突しない
  expect(sniffAudioFormat(JPEG_HEAD)).toBeNull()
  // 動画の ftyp (mp42/isom 単独) は音声として受けない
  expect(sniffAudioFormat(ftypBox('isom', ['isom', 'mp42']))).toBeNull()
  expect(sniffAudioFormat(new TextEncoder().encode('<html>'))).toBeNull()
  expect(sniffAudioFormat(new Uint8Array(0))).toBeNull()
})

// --- ブラウザ録音の形式 (41-QR-search/docs/12「ノート内録音の実装計画」) ---

test('webm は音声 CodecID があり映像 CodecID が無いときだけ音声と判定する', () => {
  // Chrome / Android の MediaRecorder が出す形 (Opus)
  expect(sniffAudioFormat(webmFile(['A_OPUS']))).toBe('webm')
  expect(sniffAudioFormat(webmFile(['A_VORBIS']))).toBe('webm')
})

test('映像トラックを含む webm・音声と判らない webm は受けない', () => {
  // 映像のみ
  expect(sniffAudioFormat(webmFile(['V_VP9']))).toBeNull()
  // 音声トラックを持つ動画 (これを通すと動画が音声として保存されてしまう)
  expect(sniffAudioFormat(webmFile(['V_VP9', 'A_OPUS']))).toBeNull()
  expect(sniffAudioFormat(webmFile(['V_VP8', 'A_OPUS']))).toBeNull()
  expect(sniffAudioFormat(webmFile(['V_AV1', 'A_OPUS']))).toBeNull()
  // EBML マジックだけでは音声と判らない
  expect(sniffAudioFormat(webmFile([]))).toBeNull()
  // 音声 CodecID の走査は先頭 64KB まで。それより後ろにしか無いものは
  // 安全側に倒して拒否する (実録音は先頭 300 バイト以内に入っている)
  expect(sniffAudioFormat(webmFile(['A_OPUS'], 64 * 1024))).toBeNull()
})

// security-reviewer の指摘 (MEDIUM)。映像 CodecID の走査まで先頭 64KB に
// 限ると、EBML の Void 要素で窓を埋めて映像トラックを走査範囲の外へ
// 押し出せてしまう。**映像側はファイル全体を見る**ことで塞ぐ
test('詰め物で 64KB の外へ押し出した映像 CodecID も見つける', () => {
  const enc = new TextEncoder()
  const padded = concatBytes([
    Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]),
    enc.encode('A_OPUS'),
    new Uint8Array(70 * 1024), // 走査窓を越えさせるための詰め物
    enc.encode('V_VP9'),
  ])
  expect(sniffAudioFormat(padded)).toBeNull()
})

test('mp4 は moov の hdlr が音声のみなら受ける (Safari の録音)', () => {
  // Safari の MediaRecorder は M4A ブランドを名乗らない。ブランドではなく
  // トラック構成で判定するので、iso5 系でも音声として受かる
  expect(sniffAudioFormat(mp4WithHandlers('iso5', ['soun']))).toBe('m4a')
  expect(sniffAudioFormat(mp4WithHandlers('mp42', ['soun']))).toBe('m4a')
})

test('映像トラックを含む mp4 は hdlr 判定でも受けない', () => {
  expect(sniffAudioFormat(mp4WithHandlers('isom', ['vide', 'soun']))).toBeNull()
  expect(sniffAudioFormat(mp4WithHandlers('isom', ['vide']))).toBeNull()
  // moov が無ければ従来どおりブランドだけが頼り
  expect(sniffAudioFormat(ftypBox('iso5', ['iso5']))).toBeNull()
})

test('録音形式を保存用の mime / ext に写す', () => {
  expect(audioSaveInfo('webm')).toEqual({ mime: 'audio/webm', ext: 'webm' })
})

test('音声形式を保存用の mime / ext に写す', () => {
  expect(audioSaveInfo('mp3')).toEqual({ mime: 'audio/mpeg', ext: 'mp3' })
  expect(audioSaveInfo('m4a')).toEqual({ mime: 'audio/mp4', ext: 'm4a' })
  expect(audioSaveInfo('wav')).toEqual({ mime: 'audio/wav', ext: 'wav' })
})
