// サーバ経由のクリップボード (docs/114-サーバクリップボード計画.md) の、
// クライアントとサーバで共有する純粋部。
//
// **このファイルはクライアントからも import される。** prisma や next/headers を
// 持ち込まないこと (読み書きは clipboard/slotStore.ts。prefs/photoMeta.ts と同じ分け方)。

export type ClipboardSlotKind = 'text' | 'image'

// API が返すメタ。文字は 64KB 以下なので本文ごと載せる (受け取る側が押した瞬間に
// 同期で writeText するため)。画像の中身は /api/clipboard/data から別に取る
export interface ClipboardSlotMeta {
  readonly kind: ClipboardSlotKind
  readonly bytes: number
  // ISO 8601。JSON を渡る値なので Date ではなく文字列
  readonly updatedAt: string
  readonly text?: string
}

// 置いてから読めなくなるまで。クリップボードにはパスワードが乗ることがあるので
// サーバに残し続けない (§1-1)
export const CLIPBOARD_TTL_MS = 10 * 60 * 1000

export const MAX_CLIPBOARD_TEXT_BYTES = 64 * 1024

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

// 「文字 120 字」「画像 1.2MB」。文字は code point で数える
// (String.length だと絵文字が 2 になる)
export function slotLabel(meta: ClipboardSlotMeta): string {
  if (meta.kind === 'text') {
    return `文字 ${[...(meta.text ?? '')].length} 字`
  }
  if (meta.bytes >= BYTES_PER_MB) {
    return `画像 ${(meta.bytes / BYTES_PER_MB).toFixed(1)}MB`
  }
  return `画像 ${Math.round(meta.bytes / BYTES_PER_KB)}KB`
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
  const { kind, bytes, updatedAt, text } = value as Record<string, unknown>
  if (typeof bytes !== 'number' || !(bytes >= 0) || typeof updatedAt !== 'string') {
    return null
  }
  if (kind === 'image') {
    return { kind, bytes, updatedAt }
  }
  if (kind === 'text' && typeof text === 'string') {
    return { kind, bytes, updatedAt, text }
  }
  return null
}
