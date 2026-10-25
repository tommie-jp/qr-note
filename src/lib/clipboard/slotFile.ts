// サーバの枠に置くファイルの形式を、中身から決める (docs/114-サーバクリップボード計画.md)。
// **サーバ側の判定**で、純粋関数なのでテストできる (prisma に触れない)。
//
// **どんなファイルも受ける。** ただし中身を解釈するのは、このアプリが添付として扱える形式
// (画像 png/jpeg/gif/webp/avif/heic/tiff・動画 mp4/mov/webm・音声 mp3/m4a/wav/webm・PDF・
// テキスト txt/csv/md/タッチストーン) と Office だけ。判定の順と部品は
// attachments/store.ts と同じ — 形式の判定を 2 か所に書くと片方だけ古くなる。
// それ以外は「ダウンロード専用のファイル」として mime を application/octet-stream に固定する。
//
// **mime は中身と名前から決めた固定の表で返す。** 申告の Content-Type は見ない。保存した mime が
// そのまま配信の Content-Type になるので、HTML や SVG (スクリプトを埋め込める) も
// octet-stream として置く。配信は attachment + nosniff + CSP sandbox で、ブラウザが
// 開いて実行する経路が無い。Office は名前と署名の両方が合ったときだけ既知の mime にする。
//
// 画像は**変換しない** (HEIC を WebP にしない、EXIF も触らない)。枠は端末から端末へ
// 原本を運ぶ道具で、10 分で消える。保存して配る添付とは役目が違う。

import { normalizeTextBytes, hasUtf16Bom } from '../text/normalizeText'
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } from '../uploads/limits'
import { startsWith } from '../uploads/sniff/bytes'
import { audioSaveInfo, sniffAudioFormat } from '../uploads/sniff/audio'
import { type ImageFormat, sniffImageFormat } from '../uploads/sniff/image'
import { sniffPdf } from '../uploads/sniff/pdf'
import { textSaveInfo } from '../uploads/sniff/text'
import { sniffVideoFormat, videoSaveInfo } from '../uploads/sniff/video'

const PDF_MIME = 'application/pdf'

// 中身を解釈しないファイルの mime。ブラウザは開かず、保存だけになる
export const OPAQUE_MIME = 'application/octet-stream'

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

  // テキストは次に試す (署名で決まる形式を取りこぼさない)
  const asText = classifyText(bytes, fileName)
  if (asText) {
    return asText
  }

  return classifyOpaque(bytes, fileName)
}

type Container = 'zip' | 'ole' | 'rtf'

// Office の拡張子 → mime と、中身の入れ物。OOXML (docx/xlsx/pptx) と ODF は zip、
// 旧 Office (doc/xls/ppt) は OLE、RTF は文字で始まる
const OFFICE: Readonly<Record<string, { mime: string; container: Container }>> = {
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', container: 'zip' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', container: 'zip' },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', container: 'zip' },
  odt: { mime: 'application/vnd.oasis.opendocument.text', container: 'zip' },
  ods: { mime: 'application/vnd.oasis.opendocument.spreadsheet', container: 'zip' },
  odp: { mime: 'application/vnd.oasis.opendocument.presentation', container: 'zip' },
  doc: { mime: 'application/msword', container: 'ole' },
  xls: { mime: 'application/vnd.ms-excel', container: 'ole' },
  ppt: { mime: 'application/vnd.ms-powerpoint', container: 'ole' },
  rtf: { mime: 'application/rtf', container: 'rtf' },
}

const CONTAINER_SIGNATURE: Readonly<Record<Container, number[]>> = {
  zip: [0x50, 0x4b, 0x03, 0x04],
  ole: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
  rtf: [0x7b, 0x5c, 0x72, 0x74, 0x66], // {\rtf
}

// ここまでのどれでもないファイル。Office は名前と署名が合えば既知の mime、他は octet-stream。
// 空は受けない (送った気になって何も届かない)
function classifyOpaque(
  bytes: Uint8Array<ArrayBuffer>,
  fileName: string | null | undefined,
): SlotFile | null {
  if (bytes.byteLength === 0) {
    return null
  }
  const ext = /\.([a-z0-9]+)$/.exec((fileName ?? '').toLowerCase())?.[1]
  const office = ext === undefined ? undefined : OFFICE[ext]
  const known = office && startsWith(bytes, CONTAINER_SIGNATURE[office.container])
  return { mime: known ? office.mime : OPAQUE_MIME, data: bytes, limit: MAX_IMAGE_BYTES }
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
