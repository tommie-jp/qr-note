// サーバ経由のクリップボード (docs/114-サーバクリップボード計画.md) の、
// クライアントとサーバで共有する純粋部。
//
// **このファイルはクライアントからも import される。** prisma や next/headers を
// 持ち込まないこと (読み書きは clipboard/slotStore.ts。prefs/photoMeta.ts と同じ分け方)。

import { timestampFileName } from '../datetime'

// 枠に入るものの種類。text はクリップボードの文字 (列 text)、残りはファイル
// (列 mime + data) で、種類は mime から決まる (kindOfMime)。
// textfile は txt / csv / md などのテキストの**ファイル** — 文字とは別物。
// file は上のどれでもないファイル (Office・zip・その他なんでも)。ダウンロード専用で、
// 中身は解釈しない (サーバは mime を application/octet-stream か Office の既知の物に固定する)
export type ClipboardSlotKind = 'text' | 'image' | 'video' | 'audio' | 'pdf' | 'textfile' | 'file'

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
  // 元のファイル名 (整形済み。sanitizeFileName)。保存・共有の名前に使う。無いこともある
  // (クリップボードの画像など)
  readonly name?: string
  // 見本の絵 (docs/115) があるか。ファイルのときだけ立つ。絵は SLOT_THUMB_URL から取る
  readonly hasThumb?: boolean
  // 見本の抜粋 (テキストファイル・Office の本文の先頭)。文字の枠は text をそのまま使う
  readonly preview?: string
}

// 見本の絵の口 (docs/115)。WebP の生バイトを返す
export const SLOT_THUMB_URL = '/api/clipboard/thumb'

const PREVIEW_MAX_LINES = 4
// 抜粋の字数の上限。サーバが置く preview もこの長さで切る (slotPreview.ts)
export const PREVIEW_MAX_CHARS = 300

// 見本に出す抜粋。先頭 4 行・300 字 (code point) まで。続きがあれば … を付ける。
// 前後の空行は落とす (先頭に空行が並ぶファイルで何も見えなくならないように)
export function previewText(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').replace(/^\s*\n|\n\s*$/g, '').split('\n')
  const head = lines.slice(0, PREVIEW_MAX_LINES).join('\n')
  const chars = Array.from(head)
  const cut = chars.length > PREVIEW_MAX_CHARS ? chars.slice(0, PREVIEW_MAX_CHARS).join('') : head
  return cut !== head || lines.length > PREVIEW_MAX_LINES ? `${cut}…` : cut
}

const FILE_KINDS: readonly ClipboardSlotKind[] = ['image', 'video', 'audio', 'pdf', 'textfile', 'file']

// 置いてから読めなくなるまで。クリップボードにはパスワードが乗ることがあるので
// サーバに残し続けない (§1-1)
export const CLIPBOARD_TTL_MS = 10 * 60 * 1000

export const MAX_CLIPBOARD_TEXT_BYTES = 64 * 1024

// mime から種類を決める。画像・動画・音声・PDF・テキスト以外は何でも file
// (ダウンロード専用)。空だけは決められないので null
export function kindOfMime(mime: string): Exclude<ClipboardSlotKind, 'text'> | null {
  const type = mime.split(';')[0]?.trim().toLowerCase() ?? ''
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('audio/')) return 'audio'
  if (type === 'application/pdf') return 'pdf'
  if (type.startsWith('text/')) return 'textfile'
  return type === '' ? null : 'file'
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
  'application/msword': 'doc',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/rtf': 'rtf',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/vnd.oasis.opendocument.presentation': 'odp',
}

const MAX_FILE_NAME_CHARS = 100
// 長い名前を切るときに残す拡張子の最大長 (".xlsx" など)
const MAX_KEPT_EXT_CHARS = 10
const FILE_NAME_UNSAFE = /[:*?"<>|]/g
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g

// 元のファイル名を、保存・共有の名前として出せる形に整える。サーバが枠に残す前と
// 画面に出す前の両方で通す。**利用者が自分で選んだ名前だが、パスや制御文字は信じない**:
// パス区切りより前を捨て (`C:\fakepath\a.pdf`・`../../x`)、ファイル名に使えない文字は _ に、
// 先頭と末尾のドット・空白を落とす。名前にならなければ null (呼ぶ側は時刻の名前にする)。
// 長すぎる名前は拡張子を残して切る (拡張子が無いと開けない)
export function sanitizeFileName(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') {
    return null
  }
  const lastSegment = raw.replace(CONTROL_CHARS, '').split(/[\\/]/).pop() ?? ''
  const cleaned = lastSegment
    .replace(FILE_NAME_UNSAFE, '_')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
  if (cleaned === '') {
    return null
  }
  const chars = Array.from(cleaned)
  if (chars.length <= MAX_FILE_NAME_CHARS) {
    return cleaned
  }
  const dot = cleaned.lastIndexOf('.')
  const ext = dot > 0 && cleaned.length - dot <= MAX_KEPT_EXT_CHARS ? cleaned.slice(dot) : ''
  return chars.slice(0, MAX_FILE_NAME_CHARS - Array.from(ext).length).join('') + ext
}

// 中身を変換したあとの名前。拡張子を付け替える (HEIC を JPEG にしたのに photo.heic のまま
// だと、開く側が形式を取り違える)。拡張子が無い名前には足す。名前が無ければ null
export function withExtension(name: string | null, ext: string): string | null {
  if (name === null) {
    return null
  }
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  return `${base}.${ext}`
}

// 保存するときの名前。元の名前が残っていればそれ (拡張子が要る)、無ければ時刻と mime から
export function slotFileName(meta: ClipboardSlotMeta, at: Date = new Date()): string {
  if (meta.name) {
    return meta.name
  }
  if (meta.kind === 'text') {
    return timestampFileName('clipboard', at, 'txt')
  }
  const type = meta.mime?.split(';')[0]?.trim().toLowerCase() ?? ''
  return timestampFileName('clipboard', at, EXT_BY_TYPE[type] ?? 'bin')
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
  file: 'ファイル',
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
      : meta.bytes >= BYTES_PER_KB
        ? `${Math.round(meta.bytes / BYTES_PER_KB)}KB`
        : `${meta.bytes}B`
  const what = meta.kind === 'file' && meta.name ? shortName(meta.name) : KIND_LABEL[meta.kind]
  return `${what} ${size}`
}

const MAX_LABEL_NAME_CHARS = 24

// 一行に収まるよう長い名前を省く。拡張子は残す (何のファイルか分かる)
function shortName(name: string): string {
  const chars = Array.from(name)
  if (chars.length <= MAX_LABEL_NAME_CHARS) {
    return name
  }
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 && name.length - dot <= 6 ? name.slice(dot) : ''
  const head = chars.slice(0, MAX_LABEL_NAME_CHARS - Array.from(ext).length - 1).join('')
  return `${head}…${ext}`
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
  const { kind, bytes, updatedAt, text, mime, name, hasThumb, preview } = value as Record<
    string,
    unknown
  >
  if (typeof bytes !== 'number' || !(bytes >= 0) || typeof updatedAt !== 'string') {
    return null
  }
  if (kind === 'text') {
    return typeof text === 'string' ? { kind, bytes, updatedAt, text } : null
  }
  // **知らない種類は「ファイル」に倒す。** 配布の直後は古い画面が新しいサーバと
  // 話す (v0.23.53 の画面が v0.23.54 で増えた 'file' を知らず、届いた送信を
  // 「応答を読めませんでした」と出した)。保存のリンクならどの種類でも渡せる
  if (typeof kind === 'string' && typeof mime === 'string') {
    return {
      kind: FILE_KINDS.includes(kind as ClipboardSlotKind) ? (kind as ClipboardSlotKind) : 'file',
      bytes,
      updatedAt,
      mime,
      ...(typeof name === 'string' ? { name } : {}),
      ...(hasThumb === true ? { hasThumb: true } : {}),
      ...(typeof preview === 'string' ? { preview } : {}),
    }
  }
  return null
}
