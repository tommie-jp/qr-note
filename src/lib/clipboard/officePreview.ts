// Office (docx・xlsx・pptx) の本文の抜粋を作る (docs/115 §4 Phase 3)。
//
// OOXML は zip で、本文は決まった 1 枚の XML に入っている。その 1 枚だけを展開し、
// タグを落として文字にする。**XML は解釈しない** (正規表現でタグを落とすだけ。外部実体も
// 展開しない)。見本なので、読めなければ null で、置くこと自体は止めない。
//
// **解凍爆弾よけ。** zip 全体は 10MB で受けているが、XML はよく縮む。読むのは目当ての
// 1 枚だけで、展開後の宣言サイズが OFFICE_XML_MAX_BYTES を超えるなら読まない。
// fflate の unzipSync は宣言サイズの出力枠に展開し、それを超える分は書かない
// (宣言を偽った zip でも、枠より大きく膨らまない。手元で確かめた)。
//
// 旧 Office (doc・xls・ppt) と ODF は対象外 (札のまま)。

import { unzipSync } from 'fflate'
import { previewText } from './slot'

export const OFFICE_XML_MAX_BYTES = 2 * 1024 * 1024
// タグを落とす XML の長さ。本文の先頭 300 字は、ふつうこの範囲に収まる
const OFFICE_XML_SCAN_BYTES = 256 * 1024

interface OfficeBody {
  // 本文の XML の zip 内の名前
  readonly entry: string
  // 1 行の区切りになる閉じタグ (段落・共有文字列の 1 件)
  readonly lineEnd: RegExp
}

const BODY_BY_MIME: Readonly<Record<string, OfficeBody>> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    entry: 'word/document.xml',
    lineEnd: /<\/w:p>/g,
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    entry: 'xl/sharedStrings.xml',
    lineEnd: /<\/si>/g,
  },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
    entry: 'ppt/slides/slide1.xml',
    lineEnd: /<\/a:p>/g,
  },
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

export function officePreview(bytes: Uint8Array, mime: string): string | null {
  const body = BODY_BY_MIME[mime]
  if (body === undefined) {
    return null
  }
  let xml: Uint8Array | undefined
  try {
    // 同名のエントリが並んでいても最初の 1 件だけ (件数ぶん 2MB の展開を走らせない)
    let seen = false
    xml = unzipSync(bytes, {
      filter: (file) => {
        if (seen || file.name !== body.entry || file.originalSize > OFFICE_XML_MAX_BYTES) {
          return false
        }
        seen = true
        return true
      },
    })[body.entry]
  } catch {
    return null
  }
  if (xml === undefined) {
    return null
  }
  // 見本は先頭 300 字で足りる。タグを落とす前の XML も先頭だけにする (処理を軽く保つ)
  const text = textOfXml(new TextDecoder().decode(xml.subarray(0, OFFICE_XML_SCAN_BYTES)), body.lineEnd)
  return text === '' ? null : previewText(text)
}

function textOfXml(xml: string, lineEnd: RegExp): string {
  return xml
    .replace(lineEnd, '\n')
    // `[^<>]` にするのが要点 (ReDoS よけ)。`[^>]` だと `>` の来ない `<` の連なりで、
    // 各 `<` から末尾まで走って二乗時間になる (2MB で数分イベントループが止まる)
    .replace(/<[^<>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, ref: string) => decodeEntity(ref) ?? whole)
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line, i, lines) => line !== '' || (i > 0 && lines[i - 1] !== ''))
    .join('\n')
    .trim()
}

function decodeEntity(ref: string): string | null {
  if (ref.startsWith('#')) {
    const code = ref[1]?.toLowerCase() === 'x' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10)
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : null
  }
  return NAMED_ENTITIES[ref.toLowerCase()] ?? null
}
