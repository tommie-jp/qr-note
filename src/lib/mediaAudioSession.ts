// iOS の音声合成を「メディア音量」で鳴らせないか試す仕掛け
// (docs/81-単語TTS発音計画.md §6-1-2)。
//
// iPhone の Web Speech は**着信音量**で鳴る。着信音を切っていると、動画も
// 音楽も鳴るのに読み上げだけ無音になる。出力先 (AVAudioSession のカテゴリ)
// はページから選べないので、正攻法では直せない。
//
// **回避の当て**: 媒体 (<audio>) の再生が始まっているとブラウザは音声
// セッションを「メディア再生」側に置く。その最中に読み上げれば、合成も
// メディア音量に乗るのではないか — という賭け。無音の 1 秒を loop で
// 鳴らしておき、読み終えたら止める。
//
// **効くかは WebKit の版に依存する。** 効かなければ今までどおり着信音量で
// 鳴るだけで、悪くはならない。副作用は「再生中は利用者が聴いている音楽が
// 止まる」こと — 発音を押している間だけなので、短い代償として許す。
//
// iOS 系以外では何もしない。iPad と PC は既に鳴っており、動く物に
// 副作用だけ足す理由がない。

import { logDiagEvent } from './diagLog'

const SAMPLE_RATE = 8000
const SILENCE_SECONDS = 1
const WAV_HEADER_BYTES = 44
// 8bit PCM の無音は 0 ではなく中央値 (128)
const PCM8_SILENCE = 128

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i))
  }
}

// 無音の WAV を組み立てる。**巨大な data URI をソースに埋めない**ため、
// 実行時に作って Blob にする (8bit / モノラル / 8kHz で 1 秒 = 8KB)。
export function buildSilentWavBytes(): Uint8Array<ArrayBuffer> {
  const dataLength = SAMPLE_RATE * SILENCE_SECONDS
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataLength)
  const view = new DataView(buffer)
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // fmt チャンクの長さ
  view.setUint16(20, 1, true) // 非圧縮 PCM
  view.setUint16(22, 1, true) // モノラル
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE, true) // 1 秒あたりのバイト数
  view.setUint16(32, 1, true) // ブロックの大きさ
  view.setUint16(34, 8, true) // 1 標本のビット数
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataLength, true)
  new Uint8Array(buffer, WAV_HEADER_BYTES).fill(PCM8_SILENCE)
  return new Uint8Array(buffer)
}

// iOS / iPadOS か。**iPad は UA が Macintosh を名乗る** (13 以降) ので、
// 触れる画面かどうかで見分ける。外したときの症状は「小技が効かない」だけ
export function isAppleTouchDevice(nav: unknown = globalThis.navigator): boolean {
  const n = nav as { userAgent?: string; maxTouchPoints?: number } | undefined
  const ua = n?.userAgent ?? ''
  if (/iPhone|iPad|iPod/i.test(ua)) {
    return true
  }
  return /Macintosh/i.test(ua) && (n?.maxTouchPoints ?? 0) > 1
}

let element: HTMLAudioElement | null = null

function ensureElement(): HTMLAudioElement | null {
  if (typeof document === 'undefined' || typeof Audio === 'undefined') {
    return null
  }
  if (element === null) {
    const blob = new Blob([buildSilentWavBytes()], { type: 'audio/wav' })
    element = new Audio(URL.createObjectURL(blob))
    element.loop = true
  }
  return element
}

// 読み上げの直前に、**ユーザー操作の中で**呼ぶこと。iOS は操作の外からの
// 再生を許さない
export function openMediaAudioSession(): void {
  if (!isAppleTouchDevice()) {
    return
  }
  const audio = ensureElement()
  if (audio === null) {
    return
  }
  // 失敗しても読み上げ自体は続く (着信音量で鳴る)。黙らせず記録だけ残す
  void audio.play().catch((e: unknown) => {
    logDiagEvent(`[発音] 無音の再生を始められない: ${String(e)}`)
  })
}

// 読み終えたら止める。鳴らしっぱなしにすると、他のアプリの音を止め続ける
export function closeMediaAudioSession(): void {
  element?.pause()
}
