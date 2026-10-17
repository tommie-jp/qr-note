// OCR 結果を memo 本文へ差し込む形の整形 (docs/24-画像OCR計画.md §4)。
//
// 認識テキストは画像の直後に markdown の引用ブロックとして入れる:
//
//   ![](/api/images/xxx.jpg)
//
//   > 冷却ファン 12V 0.1A
//   > DC FAN 40mm
//
// OCR 由来だと一目で分かり、直しやすく、引用でも全文検索は普通に効く。
// ここは純粋なテキスト整形だけを持つ (DOM も CodeMirror も触らない)。

import { AUDIO_EXTENSION_ALTERNATION } from '../audio/audioFormats'
import { TEXT_EXTENSION_ALTERNATION } from '../text/textFormats'
import { normalizeToJapanese } from './normalizeJapanese'

// 画像記法 `![alt](url)` を捕捉する (images/memoImages.ts と同じ規則)。
const IMAGE_SYNTAX = /!\[[^\]]*\]\(([^)\s]+)\)/g

// 自前の画像だけを OCR 対象にする。外部画像は fetch できるとは限らず、
// そもそもこのアプリが預かっていないので対象外。
const OWN_IMAGE_PREFIX = '/api/images/'

// 音声・PDF・テキストも `![audio](/api/images/x.mp3)` `![仕様書.pdf](…)` という
// 画像記法で本文に入る (41-QR-search/docs/12-添付ファイル種類拡張メモ.md)。OCR の対象は
// 画像だけなので、画像でない添付の URL は「後から OCR」の候補から外す
const NON_IMAGE_URL_RE = new RegExp(
  `\\.(?:${AUDIO_EXTENSION_ALTERNATION}|${TEXT_EXTENSION_ALTERNATION}|pdf)$`,
  'i',
)

// 認識結果 (改行区切り or 行の配列) を引用ブロックへ整形する。
// 日本語優先の正規化をかけ、空行を落とし、各行に `> ` を付ける。
// 中身が無ければ空文字を返す (呼び手はこれを「見つからなかった」の合図に使う)。
export function formatOcrQuote(recognized: string | readonly string[]): string {
  const rawLines = Array.isArray(recognized)
    ? recognized
    : String(recognized).split('\n')

  const lines = rawLines
    .map((line) => normalizeToJapanese(line).trim())
    .filter((line) => line.length > 0)

  if (lines.length === 0) {
    return ''
  }
  return lines.map((line) => `> ${line}`).join('\n')
}

// 認識中に本文が編集されても正しい場所を差し替えられるよう、位置ではなく
// 一意なプレースホルダ文字列を検索して置換する (画像アップロードと同じ流儀)。
// 引用ブロックとして見えるよう `> ` 始まりにしておく。
export function ocrPlaceholder(seq: number): string {
  return `> ⏳ OCR処理中 ${seq}…`
}

// 画像記法の直後に引用ブロックを差し込むためのテキスト。
// 画像行との間に空行を 1 つ空ける (markdown で引用が独立するように)。
export function ocrInsertion(placeholder: string): string {
  return `\n\n${placeholder}`
}

export interface ImageAtCursor {
  // 画像の配信名 (`<UUID>.<ext>`)。fetch と配信 URL の組み立てに使う。
  url: string
  // 画像記法の末尾位置 (この後ろへ OCR 結果を差し込む)。
  insertAt: number
}

// 本文の中の自前画像 (OCR の対象になりうるもの) を、本文の順に返す。
// start は記法の先頭 (カーソルが記法の内側かの判定に使う)
interface OwnImage extends ImageAtCursor {
  start: number
}

function ownImages(doc: string): OwnImage[] {
  const images: OwnImage[] = []
  for (const match of doc.matchAll(IMAGE_SYNTAX)) {
    const url = match[1]
    if (!url.startsWith(OWN_IMAGE_PREFIX) || NON_IMAGE_URL_RE.test(url)) {
      continue
    }
    const start = match.index
    images.push({ url, start, insertAt: start + match[0].length })
  }
  return images
}

// 「後から OCR」用: カーソル位置にいちばん近い自前画像を 1 つ選ぶ。
// カーソルが画像記法の内側にあればそれを、無ければ手前の直近の画像を、
// それも無ければ後ろの直近を選ぶ (編集中に押した位置の意図に沿う)。
export function imageAtCursor(doc: string, cursor: number): ImageAtCursor | null {
  let before: ImageAtCursor | null = null
  let after: ImageAtCursor | null = null

  for (const { url, start, insertAt } of ownImages(doc)) {
    const candidate: ImageAtCursor = { url, insertAt }
    // カーソルが記法の内側 (またはちょうど端) にあるなら即決
    if (cursor >= start && cursor <= insertAt) {
      return candidate
    }
    if (insertAt <= cursor) {
      before = candidate // 手前側は最後に見たものが直近
    } else if (after === null) {
      after = candidate // 後ろ側は最初に見たものが直近
    }
  }
  return before ?? after
}

// 画像記法の直後に OCR の引用が付いているか。
//
// ocrInsertion は記法の直後に空行 1 つを挟んで `> ` の引用を差し込む。
// 手で空行を消した形も済みとみなすので、**空行 0〜1 つの後の行が `> ` で
// 始まる**かを見る。処理中のプレースホルダ (`> ⏳ OCR処理中 n…`) も同じ形
// なので、走っている画像も自然に飛ぶ。
//
// 手で書いた普通の引用が画像の直後にあっても「済み」に見える。
// その画像を読ませたいときは、カーソルを置いて「この画像」で読ませる
const OCR_QUOTE_AFTER_IMAGE = /^[ \t]*\r?\n(?:[ \t]*\r?\n)?>/

// 見るのは記法の直後の数行だけ (空白・改行 2 つ・`>` で足りる)
const LOOKAHEAD_CHARS = 64

function hasOcrQuoteAfter(doc: string, imageEnd: number): boolean {
  return OCR_QUOTE_AFTER_IMAGE.test(
    doc.slice(imageEnd, imageEnd + LOOKAHEAD_CHARS),
  )
}

// コードフェンス (``` / ~~~) の中の範囲 [start, end)。閉じていないフェンスは
// 本文の末尾まで続くとみなす (CommonMark と同じ)
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/

function fencedRanges(doc: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  let open: { mark: string; start: number } | null = null
  let lineStart = 0
  for (const line of doc.split('\n')) {
    const fence = FENCE_LINE.exec(line)?.[1]
    if (open === null && fence !== undefined) {
      open = { mark: fence, start: lineStart }
    } else if (
      open !== null &&
      fence !== undefined &&
      fence[0] === open.mark[0] &&
      fence.length >= open.mark.length
    ) {
      ranges.push([open.start, lineStart + line.length])
      open = null
    }
    lineStart += line.length + 1
  }
  if (open !== null) {
    ranges.push([open.start, doc.length])
  }
  return ranges
}

// 画像記法の行が引用 (`>`) の中か
function isInBlockquote(doc: string, start: number): boolean {
  const lineStart = doc.lastIndexOf('\n', start - 1) + 1
  return /^ {0,3}>/.test(doc.slice(lineStart, start))
}

// 「ノートの全画像を OCR」の対象 (docs/106-OCR切替と全画像OCR計画.md §2)。
// 自前画像のうち、直後に OCR の引用が付いていないものを本文の順に返す。
//
// 次の 2 つは**問わずに読む**全画像 OCR からは外す (要るならカーソルを置いて
// 「この画像」で読ませる)。
// - コードフェンスの中: 記法の例として書いたもの。引用を差すとコードが変わる
// - 引用の中: 直後に `> ` の行が続くので済みと区別できず、差すと元の引用に混ざる
export function imagesWithoutOcr(doc: string): ImageAtCursor[] {
  const fences = fencedRanges(doc)
  const inFence = (pos: number) =>
    fences.some(([start, end]) => pos >= start && pos < end)
  return ownImages(doc)
    .filter(
      (image) =>
        !inFence(image.start) &&
        !isInBlockquote(doc, image.start) &&
        !hasOcrQuoteAfter(doc, image.insertAt),
    )
    .map(({ url, insertAt }) => ({ url, insertAt }))
}
