// サーバ経由のクリップボード (docs/114-サーバクリップボード計画.md) の、
// クライアントとサーバで共有する純粋部。
//
// **このファイルはクライアントからも import される。** prisma や next/headers を
// 持ち込まないこと (読み書きは clipboard/slotStore.ts。prefs/photoMeta.ts と同じ分け方)。

import { timestampFileName } from '../datetime'

// 枠に入るものの種類。text はクリップボードの文字 (列 text)、残りはファイル
// (列 mime + data) で、種類は mime から決まる (kindOfMime)。
// textfile は txt / csv / md などのテキストの**ファイル** — 文字とは別物
export type ClipboardSlotKind = 'text' | 'image' | 'video' | 'audio' | 'pdf' | 'textfile'

// API が返すメタ。文字は 64KB 以下なので本文ごと載せる (受け取る側が押した瞬間に
// 同期で writeText するため)。ファイルの中身は /api/clipboard/data から別に取る。
// mime はファイルのときだけ付く (保存名の拡張子を決めるのに要る)
export interface ClipboardSlotMeta {
  readonly kind: ClipboardSlotKind
  readonly bytes: number
  // ISO 8601。JSON を渡る値なので Date ではなく文字列
  readonly updatedAt: string
  readonly text?: string
  readonly mime?: string
}

const FILE_KINDS: readonly ClipboardSlotKind[] = ['image', 'video', 'audio', 'pdf', 'textfile']

// 置いてから読めなくなるまで。クリップボードにはパスワードが乗ることがあるので
// サーバに残し続けない (§1-1)
export const CLIPBOARD_TTL_MS = 10 * 60 * 1000

export const MAX_CLIPBOARD_TEXT_BYTES = 64 * 1024

// mime から種類を決める。知らない mime (HTML・zip・任意のバイナリ) は null。
// サーバはこの外の形式を受けない (slotFile.ts)
export function kindOfMime(mime: string): Exclude<ClipboardSlotKind, 'text'> | null {
  const type = mime.split(';')[0]?.trim().toLowerCase() ?? ''
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('audio/')) return 'audio'
  if (type === 'application/pdf') return 'pdf'
  if (type.startsWith('text/')) return 'textfile'
  return null
}

// OS のクリップボードに載せて他のアプリへ貼れるのは文字と画像だけ。動画・音声・
// PDF・テキストのファイルは、ブラウザからクリップボードへ載せる手段が無いので、
// 受け取りは「保存」になる
export function isPasteable(kind: ClipboardSlotKind): boolean {
  return kind === 'text' || kind === 'image'
}

const EXT_BY_TYPE: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/tiff': 'tiff',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
  'application/pdf': 'pdf',
  'text/csv': 'csv',
  'text/markdown': 'md',
}

// 保存するときの名前。サーバの枠には元の名前を残していない — 外へ出る名前に
// 利用者由来の文字列を使わない。時刻だけで足りる
export function slotFileName(meta: ClipboardSlotMeta, at: Date = new Date()): string {
  const type = meta.mime?.split(';')[0]?.trim().toLowerCase() ?? ''
  return timestampFileName('clipboard', at, EXT_BY_TYPE[type] ?? 'txt')
}

const MS_PER_MINUTE = 60 * 1000
const BYTES_PER_KB = 1024
const BYTES_PER_MB = 1024 * 1024

// 期限が切れているか。**読めない日時は切れた扱い** — 「生きている」へ倒すと、
// 消えるはずの中身が残り続ける
export function isSlotExpired(updatedAt: Date | string | number, now: Date = new Date()): boolean {
  const at = new Date(updatedAt).getTime()
  if (Number.isNaN(at)) {
    return true
  }
  return now.getTime() - at >= CLIPBOARD_TTL_MS
}

export function textByteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

const KIND_LABEL: Readonly<Record<Exclude<ClipboardSlotKind, 'text'>, string>> = {
  image: '画像',
  video: '動画',
  audio: '音声',
  pdf: 'PDF',
  textfile: 'テキストファイル',
}

// 「文字 120 字」「画像 1.2MB」「動画 12.3MB」。文字は code point で数える
// (String.length だと絵文字が 2 になる)
export function slotLabel(meta: ClipboardSlotMeta): string {
  if (meta.kind === 'text') {
    return `文字 ${[...(meta.text ?? '')].length} 字`
  }
  const size =
    meta.bytes >= BYTES_PER_MB
      ? `${(meta.bytes / BYTES_PER_MB).toFixed(1)}MB`
      : `${Math.round(meta.bytes / BYTES_PER_KB)}KB`
  return `${KIND_LABEL[meta.kind]} ${size}`
}

// 「いま」「3 分前」。10 分で消えるので分より大きい単位は要らない。
// 時計のずれで未来になっても負の分を出さない
export function agoLabel(updatedAt: Date | string | number, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - new Date(updatedAt).getTime()) / MS_PER_MINUTE)
  return minutes < 1 ? 'いま' : `${minutes} 分前`
}

// API の応答を畳む。クライアント側は寛容でよい (知らない形は「無い」と見なす)。
// 厳しく断るのはサーバの PUT の側
export function parseSlotMeta(value: unknown): ClipboardSlotMeta | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const { kind, bytes, updatedAt, text, mime } = value as Record<string, unknown>
  if (typeof bytes !== 'number' || !(bytes >= 0) || typeof updatedAt !== 'string') {
    return null
  }
  if (kind === 'text') {
    return typeof text === 'string' ? { kind, bytes, updatedAt, text } : null
  }
  if (FILE_KINDS.includes(kind as ClipboardSlotKind) && typeof mime === 'string') {
    return { kind: kind as ClipboardSlotKind, bytes, updatedAt, mime }
  }
  return null
}
