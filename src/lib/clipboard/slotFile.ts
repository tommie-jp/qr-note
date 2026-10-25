// サーバの枠に置くファイルの形式を、中身から決める (docs/114-サーバクリップボード計画.md)。
// **サーバ側の判定**で、純粋関数なのでテストできる (prisma に触れない)。
//
// **このアプリが添付として扱える形式だけを受ける。** 画像 (png/jpeg/gif/webp/avif/
// heic/tiff)・動画 (mp4/mov/webm)・音声 (mp3/m4a/wav/webm)・PDF・テキスト (txt/csv/md/
// タッチストーン)。判定の順と部品は attachments/store.ts と同じ — 形式の判定を
// 2 か所に書くと片方だけ古くなる。
//
// **mime は中身から決めた固定の表で返す。** 申告の Content-Type は見ない。保存した mime が
// そのまま配信の Content-Type になるので、HTML や SVG (スクリプトを埋め込める) を
// 受けないことが XSS を防ぐ要。任意のバイナリ (exe・zip) も受けない。
//
// 画像は**変換しない** (HEIC を WebP にしない、EXIF も触らない)。枠は端末から端末へ
// 原本を運ぶ道具で、10 分で消える。保存して配る添付とは役目が違う。

import { normalizeTextBytes, hasUtf16Bom } from '../text/normalizeText'
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } from '../uploads/limits'
import { audioSaveInfo, sniffAudioFormat } from '../uploads/sniff/audio'
import { type ImageFormat, sniffImageFormat } from '../uploads/sniff/image'
import { sniffPdf } from '../uploads/sniff/pdf'
import { textSaveInfo } from '../uploads/sniff/text'
import { sniffVideoFormat, videoSaveInfo } from '../uploads/sniff/video'

const PDF_MIME = 'application/pdf'

const IMAGE_MIME: Readonly<Record<ImageFormat, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  heic: 'image/heic',
  tiff: 'image/tiff',
}

export interface SlotFile {
  readonly mime: string
  // 置くバイト列。テキストだけ UTF-8 に正規化したもの (他は受け取ったまま)
  readonly data: Uint8Array<ArrayBuffer>
  // この種類の上限。動画 30MB、それ以外 10MB (添付と同じ。理由は uploads/limits.ts)。
  // 超えたかどうかは呼ぶ側が見る (断り文を口の側で組むため)
  readonly limit: number
}

// 形式を決める。受けない形式は null。
//
// fileName はテキストの判定にだけ使う (テキストには署名が無く、拡張子でしか区別できない)。
// 申告をそのまま保存名にはしない — 保存するのは mime だけ
export function classifySlotFile(
  bytes: Uint8Array<ArrayBuffer>,
  fileName: string | null | undefined,
): SlotFile | null {
  // 動画は他より上限が大きいので先に判定する (store.ts と同じ理由)
  const video = sniffVideoFormat(bytes)
  if (video) {
    return { mime: videoSaveInfo(video).mime, data: bytes, limit: MAX_VIDEO_BYTES }
  }

  const image = sniffImageFormat(bytes)
  if (image) {
    return { mime: IMAGE_MIME[image], data: bytes, limit: MAX_IMAGE_BYTES }
  }

  // UTF-16 の BOM を持つテキストは音声判定より先に確定させる (`FF FE` が緩い MP3 判定に
  // 横取りされる。store.ts と同じ理由)
  if (hasUtf16Bom(bytes)) {
    const asText = classifyText(bytes, fileName)
    if (asText) {
      return asText
    }
  }

  const audio = sniffAudioFormat(bytes)
  if (audio) {
    return { mime: audioSaveInfo(audio).mime, data: bytes, limit: MAX_IMAGE_BYTES }
  }

  if (sniffPdf(bytes)) {
    return { mime: PDF_MIME, data: bytes, limit: MAX_IMAGE_BYTES }
  }

  // テキストは最後に試す (署名で決まる形式を取りこぼさない)
  return classifyText(bytes, fileName)
}

// 名前がテキストで、かつ中身がテキストとして読めたときだけ。どちらかが欠ければ null
function classifyText(
  bytes: Uint8Array<ArrayBuffer>,
  fileName: string | null | undefined,
): SlotFile | null {
  const info = textSaveInfo(fileName)
  if (!info) {
    return null
  }
  const normalized = normalizeTextBytes(bytes)
  if (!normalized) {
    return null
  }
  return { mime: info.mime, data: normalized, limit: MAX_IMAGE_BYTES }
}
