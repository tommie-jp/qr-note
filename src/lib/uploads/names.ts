// 保存名と配信 mime の規則 (docs/93-リファクタリング計画.md §4-2)。
//
// 配信ゲート (api/images/[name])・proxy の素通し判定 (publicPaths)・本文の画像参照
// (memoImages・attachmentChip) などクライアントからも読むので、バイト列の判定
// (sniff/) から切り離して軽く保つ。**sniff/ を import しない** (向きは sniff → names)。

import { AUDIO_EXTENSION_ALTERNATION } from '../audioFormats'
import {
  TEXT_EXTENSION_ALTERNATION,
  TEXT_EXTENSIONS,
  type TextFormat,
} from '../textFormats'
import { VIDEO_EXTENSION_ALTERNATION } from '../videoFormats'

// 保存できる画像形式 (final mime) → 拡張子。
// これは「そのまま DB に保存できる = ブラウザが表示できる」形式の表。
// HEIC/HEIF・TIFF は保存時に WebP へ変換するのでここには無い
// (変換後の image/webp として入る。docs/26-画像形式対応計画.md §2)。
// SVG はスクリプトを埋め込めるため対応しない。
const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
}

// 保存ファイル名は「サーバが生成した UUID + 対応拡張子」のみ。
// クライアント由来の文字列をパスに使わないことでトラバーサルを防ぐ。
// 画像・音声・動画・PDF・テキストの 5 種がすべてこの形で、違うのは拡張子だけ。
//
// extAlternation は "png|jpg" のような選択肢をそのまま埋める。拡張子は英数字
// だけなので正規表現のエスケープは要らない (audioFormats.ts などと同じ前提)。
// UUID は小文字だけを許す (サーバが生成する形そのもの)
export function uuidNamePattern(extAlternation: string): RegExp {
  return new RegExp(
    `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(${extAlternation})$`,
  )
}

// heic/tiff は変換後に webp になるため、ここには現れない
const IMAGE_NAME_PATTERN = uuidNamePattern('png|jpg|gif|webp|avif')

export function extForMime(mime: string): string | null {
  return MIME_TO_EXT[mime] ?? null
}

export function mimeForName(name: string): string | null {
  const ext = name.split('.').pop()
  const entry = Object.entries(MIME_TO_EXT).find(([, e]) => e === ext)
  return entry ? entry[0] : null
}

export function isValidImageName(name: string): boolean {
  return IMAGE_NAME_PATTERN.test(name)
}

// --- 音声 (41-QR-search/docs/12-添付ファイル種類拡張メモ.md) ---

// 保存できる音声形式 (final mime) → 拡張子。画像の MIME_TO_EXT と同じ役割で、
// 配信時に「DB の mime を信じてよいか」の判定にも使う (未知 mime を配らない)。
// **video/webm は載せない** — 受け付けるのは音声トラックだけの webm なので、
// 動画として配信する mime は持たない。
const AUDIO_MIME_TO_EXT: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
}

// 保存名は画像と同じ「UUID + 対応拡張子」だけ。拡張子は形式名がそのまま入る。
const AUDIO_NAME_PATTERN = uuidNamePattern(AUDIO_EXTENSION_ALTERNATION)

export function isValidAudioName(name: string): boolean {
  return AUDIO_NAME_PATTERN.test(name)
}

// 画像・音声・PDF のいずれの保存名も許すか。配信ゲート (route.ts) と proxy の
// 素通し判定 (publicPaths.ts) が使う。**memoImages などの「画像だけ」を
// 拾う経路は isValidImageName のままにする** — 音声や PDF を一覧サムネや画像
// 検索の対象に混ぜないため (この 2 つを分けているのが肝)。
export function isValidAttachmentName(name: string): boolean {
  return (
    isValidImageName(name) ||
    isValidAudioName(name) ||
    isValidVideoName(name) ||
    isValidPdfName(name) ||
    isValidTextName(name)
  )
}

// 配信時に Content-Type としてそのまま返してよい mime か。画像・音声・PDF とも
// 保存時に中身を検証済みだが、DB の値を鵜呑みにせず既知の mime のときだけ採用する。
export function isAllowedContentMime(mime: string): boolean {
  return (
    mime in MIME_TO_EXT ||
    mime in AUDIO_MIME_TO_EXT ||
    mime in VIDEO_MIME_TO_EXT ||
    mime === PDF_MIME ||
    mime in TEXT_MIME_TO_EXT
  )
}

// --- 動画 (41-QR-search/docs/14-動画挿入計画.md) ---

// 配信時に「DB の mime を信じてよいか」の判定に使う (未知 mime を配らない)。
// キーだけを見るので値は保存拡張子でよい。
const VIDEO_MIME_TO_EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'mkv',
  'video/quicktime': 'mov',
}

// 保存名は画像・音声と同じ「UUID + 対応拡張子」だけ (拡張子は mp4/mkv/mov)。
const VIDEO_NAME_PATTERN = uuidNamePattern(VIDEO_EXTENSION_ALTERNATION)

export function isValidVideoName(name: string): boolean {
  return VIDEO_NAME_PATTERN.test(name)
}

// --- PDF (41-QR-search/docs/12-添付ファイル種類拡張メモ.md) ---

export const PDF_MIME = 'application/pdf'
export const PDF_EXT = 'pdf'

// 保存名は画像・音声と同じ「UUID + .pdf」だけ (トラバーサル対策)。
const PDF_NAME_PATTERN = uuidNamePattern(PDF_EXT)

export function isValidPdfName(name: string): boolean {
  return PDF_NAME_PATTERN.test(name)
}

// --- テキスト系 (41-QR-search/docs/12-添付ファイル種類拡張メモ.md) ---
//
// 配信 mime に charset を含めるのは、保存時に必ず UTF-8 へ正規化しているから
// (normalizeText.ts)。表示側が文字コードを推測する必要が無くなる。
// 保存する mime / ext を名前から決める側は sniff/text.ts の textSaveInfo。
export const TEXT_FORMAT_TO_MIME: Record<TextFormat, string> = {
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
}

// 保存できるテキスト形式 (final mime) → 拡張子。画像の MIME_TO_EXT と同じ役割で、
// 配信時に「DB の mime を信じてよいか」の判定に使う。
// **text/html はここに無い** — HTML はテキストとして読めるので判定は通るが、
// 保存名は txt に倒し text/plain で配るため、mime としては現れない。
const TEXT_MIME_TO_EXT: Record<string, string> = Object.fromEntries(
  TEXT_EXTENSIONS.map((ext) => [TEXT_FORMAT_TO_MIME[ext], ext]),
)

// 保存名は画像・音声・PDF と同じ「UUID + 対応拡張子」だけ。
const TEXT_NAME_PATTERN = uuidNamePattern(TEXT_EXTENSION_ALTERNATION)

export function isValidTextName(name: string): boolean {
  return TEXT_NAME_PATTERN.test(name)
}
