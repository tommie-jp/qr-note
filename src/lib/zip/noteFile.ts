// ノート 1 件と Markdown ファイル 1 枚の相互変換 (docs/28-エクスポート計画.md §1)。
//
// 書き出し (buildNoteFile) と読み込み (parseNoteFile) を**必ず同じファイルに置く**。
// 往復できることがこの機能の要件なので、片方だけ直されて解釈がずれる余地を
// 減らす (テストも往復で書いてある)。
//
// DB には触らない純関数だけを置く。保存経路は既存の upsertMemo を通す
// (インポート専用の保存経路を作らない = §4 の方針をそのまま引き継ぐ)。

import { isValidAttachmentName } from '@/lib/uploads/names'
import {
  isLegacyItemNo,
  isValidItemId,
  MAX_TEXT_LENGTH,
} from '@/lib/validation'
import {
  type FrontmatterValue,
  parseFrontmatter,
  serializeFrontmatter,
} from './frontmatter'

// ノートの識別は 2 通り (docs/107 §4-2)。
//   id     … このアプリの v0.23.33 以降が書き出した ZIP。UUID v7
//   itemNo … それより前の ZIP と、教科書の変換スクリプトが組む ZIP。旧番号
// どちらか片方は必ずある。旧番号しか無いノートは、取り込み側が本文のタグ
// `#<旧番号>` で既存ノートを探す (lib/zip/importZip.ts の writeNote)
export type NoteKey =
  | { kind: 'id'; itemId: string }
  | { kind: 'legacy'; itemNo: string }

export interface PortableNote {
  key: NoteKey
  memo: string
  // 手書きの Markdown には無いことがある (その場合は取り込んだ時刻になる)
  createdAt: Date | null
  updatedAt: Date | null
  isPublic: boolean
}

// 本文が持つ配信 URL と、ZIP の中の相対パス。
//
// 相対パスにするのは Obsidian などの vault にそのまま置いて読めるようにするため
// (docs/28 §1)。`notes/x.md` から見て添付は `../images/` にある。
const API_PREFIX = '/api/images/'
const ZIP_PREFIX = '../images/'

// 保存名に使われる文字。ここで拾ってから isValidAttachmentName で確かめる
// (拾う網は広く、通す門は狭く)。
const NAME_CHARS = '[A-Za-z0-9.-]+'

// 参照を探す正規表現。**接頭辞の定数から組み立てる**ので、書き換え先を直しても
// 探す側が取り残されない。/g 付きだが replace は lastIndex を戻し matchAll は
// 複製を使うので、使い回しても状態は漏れない
const API_REF = new RegExp(`${escapeRegExp(API_PREFIX)}(${NAME_CHARS})`, 'g')
const ZIP_REF = new RegExp(`${escapeRegExp(ZIP_PREFIX)}(${NAME_CHARS})`, 'g')

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

// 書き出すノート。DB の行なので必ず id がある
export type ExportNote = Omit<PortableNote, 'key'> & { itemId: string }

export function buildNoteFile(note: ExportNote): string {
  const fields: [string, FrontmatterValue][] = [
    ['id', { quoted: note.itemId }],
    ['created', { bare: isoOrEmpty(note.createdAt) }],
    ['updated', { bare: isoOrEmpty(note.updatedAt) }],
    ['public', { bare: String(note.isPublic) }],
  ]
  // 本文の末尾には必ず改行を 1 つ足す。読む側が必ず 1 つ外すことで、
  // 「改行で終わる memo」も「終わらない memo」も同じ形で往復する
  return `${serializeFrontmatter(fields)}${toZipLinks(note.memo)}\n`
}

export type ParsedNoteFile =
  | { ok: true; note: PortableNote }
  | { ok: false; reason: string }

// Markdown ファイル 1 枚をノートに戻す。
//
// **読めないファイルは理由付きで断る** (docs/28 §3)。呼ぶ側はそのファイルだけを
// 見送ってレポートに載せ、ZIP 全体は止めない。
export function parseNoteFile(text: string): ParsedNoteFile {
  const parsed = parseFrontmatter(text)
  if (parsed === null) {
    return {
      ok: false,
      reason: '先頭の frontmatter (--- で挟んだ項目) を読めませんでした',
    }
  }

  const key = parseNoteKey(parsed.fields.get('id'), parsed.fields.get('itemNo'))
  if (typeof key === 'string') {
    return { ok: false, reason: key }
  }

  const createdAt = parseDateField(parsed.fields.get('created'))
  const updatedAt = parseDateField(parsed.fields.get('updated'))
  if (createdAt === 'invalid' || updatedAt === 'invalid') {
    return { ok: false, reason: '作成・更新日時を読めませんでした' }
  }

  const isPublic = parseBoolField(parsed.fields.get('public'))
  if (isPublic === 'invalid') {
    return { ok: false, reason: 'public は true か false で書いて下さい' }
  }

  // 旧い ZIP (docs/110 より前) の url / mode は本文へ折り込む。列はもう無い
  const legacyUrl = parsed.fields.get('url') ?? ''
  const memo = foldLegacyUrl(
    toApiLinks(stripOneTrailingNewline(normalizeNewlines(parsed.body))),
    legacyUrl,
    parsed.fields.get('mode') === 'url',
  )
  const tooLong = overLengthReason(memo, legacyUrl !== '')
  if (tooLong !== null) {
    return { ok: false, reason: tooLong }
  }

  return {
    ok: true,
    note: {
      key,
      memo,
      createdAt,
      updatedAt,
      isPublic,
    },
  }
}

// id を先に見る。両方あれば id が正本 (旧番号は本文のタグにも入っている)。
// 戻り値が文字列なら断る理由
function parseNoteKey(
  id: string | undefined,
  itemNo: string | undefined,
): NoteKey | string {
  if (id !== undefined && id !== '') {
    return isValidItemId(id) ? { kind: 'id', itemId: id } : `id が書式外です (${id})`
  }
  if (itemNo !== undefined && itemNo !== '') {
    return isLegacyItemNo(itemNo)
      ? { kind: 'legacy', itemNo }
      : `itemNo が書式外です (${itemNo})`
  }
  return 'id がありません'
}

// 本文が参照している添付の保存名を出現順・重複なしで返す。
//
// **一覧サムネの抽出規則 (lib/images/memoImages.ts) とは意図して別物**。あちらは
// 「そのノートの顔になる絵」を選ぶので Markdown の画像記法だけを見てコードの
// 中を外すが、こちらは「本文が指しているものを 1 つも落とさない」ための走査
// なので、記法もコードフェンスも問わず URL の形だけで拾う。書き出しから漏れた
// 添付は、戻したときに黙って画像切れになる。
export function collectAttachmentNames(memo: string): string[] {
  const names = new Set<string>()
  for (const match of memo.matchAll(API_REF)) {
    if (isValidAttachmentName(match[1])) {
      names.add(match[1])
    }
  }
  return [...names]
}

// 参照の書き換えは**保存名として妥当なものだけ**に当てる。単純な文字列置換に
// すると、本文にたまたま書かれた `../images/…` という文字列まで配信 URL に
// 化けてしまう (往復で本文が変わる)。
//
// 行きと帰りで同じ関数を使う — 往復で解釈がずれない形にしておく
function rewriteRefs(text: string, pattern: RegExp, prefix: string): string {
  return text.replace(pattern, (whole, name: string) =>
    isValidAttachmentName(name) ? `${prefix}${name}` : whole,
  )
}

const toZipLinks = (memo: string) => rewriteRefs(memo, API_REF, ZIP_PREFIX)
const toApiLinks = (body: string) => rewriteRefs(body, ZIP_REF, API_PREFIX)

function isoOrEmpty(value: Date | null): string {
  // 日時は UTC の ISO 8601 で書く。時差を持つ表記より往復が確実で、
  // 表示に使う値ではない (画面はブラウザの時刻で描く)
  return value === null ? '' : value.toISOString()
}

// 空欄は「無い」(null)、読めない値は 'invalid' として呼び出し側が断る。
// 黙って「いま」に倒すと、日時の壊れたファイルが正常に取り込めたように見える
function parseDateField(raw: string | undefined): Date | null | 'invalid' {
  if (raw === undefined || raw.trim() === '') {
    return null
  }
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? 'invalid' : parsed
}

function parseBoolField(raw: string | undefined): boolean | 'invalid' {
  const value = raw?.trim() ?? ''
  if (value === '' || value === 'false') {
    return false
  }
  return value === 'true' ? true : 'invalid'
}

function overLengthReason(memo: string, foldedUrl: boolean): string | null {
  // 上限は編集フォームと同じ (validation.ts)。ここだけ緩いと、取り込めたのに
  // 編集画面から保存し直せないノートができる。
  // 旧い url 欄を折り込んだ分で超えたときは、その旨を添える (書き出した時点では
  // 本文も URL も上限内だったノートなので、理由が判らないと直しようがない)
  if (memo.length > MAX_TEXT_LENGTH) {
    const note = foldedUrl ? '。旧い url 欄を本文へ折り込んだ後の長さです' : ''
    return `本文が長すぎます (${memo.length} 文字 / 上限 ${MAX_TEXT_LENGTH} 文字)${note}`
  }
  return null
}

// 手元のエディタ (Windows) で編集して戻せるように改行を LF へ寄せる。
// memo の正本はブラウザから来た LF なので、CRLF のまま入れると tags/props の
// 抽出やテキスト比較が静かにずれる
function normalizeNewlines(body: string): string {
  return body.replace(/\r\n/g, '\n')
}

function stripOneTrailingNewline(body: string): string {
  return body.endsWith('\n') ? body.slice(0, -1) : body
}

// 旧い ZIP の url 欄を本文へ折り込む (docs/110-URL列廃止計画.md)。
// DB 側の移行 (migration の UPDATE) と同じ形にする:
//   URL ノート (mode: url) … URL を 1 行目にし、元の本文を空行を挟んで続ける
//   メモのノート … 本文の**末尾**に空行を挟んで URL の段落を足す。
//     1 行目の直後に挟まないのは、1 行目がフェンスの開始や表のヘッダだと
//     構造を割ってしまうため (レビューで判明)
export function foldLegacyUrl(memo: string, rawUrl: string, isUrlNote: boolean): string {
  // 空白・改行だけの url が実データにある (Ver1 由来)。折り込む物が無いなら本文のまま
  const url = rawUrl.trim()
  if (url === '') {
    return memo
  }
  if (memo === '') {
    return url
  }
  return isUrlNote ? `${url}\n\n${memo}` : `${memo}\n\n${url}`
}
