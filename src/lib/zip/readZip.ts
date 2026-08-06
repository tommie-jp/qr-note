// ZIP のバイト列を項目の並びに開く (docs/28-エクスポート計画.md §3)。
//
// **書き込み境界なので、開く前と開いている最中の両方で門を敷く**。ZIP は
// 「入口が小さくても出口が無限になりうる」形式で、10MB のファイルから数 GB を
// 取り出せる (ZIP 爆弾)。門は 2 段:
//
//   1. ヘッダが展開後の大きさを名乗っているなら、**展開する前に**それで断る
//   2. 名乗っていないものは、出てきたバイト数を数えて上限で断つ
//
// **1 段目が本命で、2 段目は取りこぼしを拾うだけ**である点は正直に書いておく。
// fflate の UnzipInflate は 1 項目を 1 回の ondata でまとめて渡してくるため、
// 2 段目が火を噴く時点でその 1 項目ぶんの確保は済んでいる (実測: 80MB の項目は
// 80MB のチャンク 1 つで届く。入力を細切れに push しても変わらない)。つまり
// 2 段目が守るのは「積み上がり」であって「1 項目の山」ではない。
//
// それでも実害が小さいのは、この口がログイン必須の単独利用者向けで、入口が
// 10MB に絞られていて、確保に失敗しても RangeError を 400 に写して応答を
// 返せるため。**守れている範囲を過大に書かない**ことのほうが、後で読む人の
// 判断を助ける。
//
// 展開そのものは同期 (UnzipInflate)。入口が 10MB に絞られているぶんイベント
// ループを長く塞ぐことはなく、非同期版のように「途中で失敗したときにどこまで
// 進んだか」を追う必要もない。

import { concatBytes } from '@/lib/bytes'
import { Unzip, UnzipInflate } from 'fflate'
import {
  MAX_ZIP_ENTRIES,
  MAX_ZIP_FILE_BYTES,
  MAX_ZIP_TOTAL_BYTES,
} from './limits'

export interface RawZipEntry {
  path: string
  data: Uint8Array
}

// 利用者にそのまま見せてよい失敗。fflate 由来の失敗 (素の文言が意味を成さない)
// や、想定外の例外と区別するために型で持つ — 文言の書き出しで見分けようとすると、
// 文言を直した拍子に判定が静かに壊れる。
export class ZipReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipReadError'
  }
}

// ZIP の先頭 4 バイト。fflate の Unzip は**署名の無いデータを黙って読み飛ばす**
// ので、これを見ないと「別のファイルを選んだ」が「0 件取り込めました」になる。
// 中身が ZIP かどうかを問うのはここだけにする (取り込み口の振り分けも
// isZipBytes を呼ぶ)
const LOCAL_FILE_HEADER = [0x50, 0x4b, 0x03, 0x04]
const EMPTY_ARCHIVE = [0x50, 0x4b, 0x05, 0x06]
const SPANNED_ARCHIVE = [0x50, 0x4b, 0x07, 0x08]

// 判定に要る先頭バイト数。ファイル全体を読む前の振り分け (/api/import) が、
// 何バイト切り出せばよいかをこれで知る
export const ZIP_SIGNATURE_BYTES = LOCAL_FILE_HEADER.length

// 先頭が ZIP の署名か。
export function isZipBytes(head: Uint8Array): boolean {
  return zipSignature(head) !== null
}

// ZIP を開いて全項目を返す。**ファイルごと断る事情**は ZipReadError で投げる
// (ZIP として読めない・大きすぎる・多すぎる)。個々のノートの良し悪しは
// ここでは見ない (importZip.ts がレポートに載せる)。
export function readZipEntries(zip: Uint8Array): RawZipEntry[] {
  const signature = zipSignature(zip)
  if (signature === null) {
    throw new ZipReadError(
      'ZIP ファイルではありません (拡張子と中身が食い違っていないか確かめて下さい)',
    )
  }

  const entries: RawZipEntry[] = []
  let totalBytes = 0

  const unzip = new Unzip()
  unzip.register(UnzipInflate)
  unzip.onfile = (file) => {
    // ディレクトリ項目は中身を持たない。数にも入れない
    if (file.name.endsWith('/')) {
      return
    }
    if (entries.length >= MAX_ZIP_ENTRIES) {
      throw new ZipReadError(
        `ZIP に入っているファイルが多すぎます (上限 ${MAX_ZIP_ENTRIES} 個)。ノートを分けて書き出してから取り込んで下さい`,
      )
    }
    // **1 段目**: 名乗っている大きさで、展開を始める前に断る。ここを通せば
    // 巨大な確保そのものが起きない。名乗らない ZIP (このアプリの書き出しも
    // データ記述子を使うので名乗らない) は undefined になり、2 段目に委ねる
    if (file.originalSize !== undefined && file.originalSize > MAX_ZIP_FILE_BYTES) {
      throw new ZipReadError(tooLargeInside(file.name))
    }

    const chunks: Uint8Array[] = []
    let size = 0
    const path = file.name

    file.ondata = (error, chunk, final) => {
      if (error) {
        throw error
      }
      size += chunk.length
      totalBytes += chunk.length
      // **2 段目**: 出てきたバイト数で数える。名乗りは当てにならない
      if (size > MAX_ZIP_FILE_BYTES) {
        throw new ZipReadError(tooLargeInside(path))
      }
      if (totalBytes > MAX_ZIP_TOTAL_BYTES) {
        throw new ZipReadError(
          `展開後の合計が大きすぎます (上限 ${megabytes(MAX_ZIP_TOTAL_BYTES)}MB)`,
        )
      }
      chunks.push(chunk)
      if (final) {
        // UnzipInflate は同期なので、次の項目が始まる前にここへ来る。
        // 並び順は ZIP の並びのまま
        entries.push({ path, data: concatBytes(chunks, size) })
      }
    }
    file.start()
  }

  try {
    // 入口は既に 10MB に絞られているので 1 回で押し込む。UnzipInflate は
    // 同期なので、この呼び出しが返った時点で全項目が揃っている
    unzip.push(zip, true)
  } catch (error) {
    if (error instanceof ZipReadError) {
      throw error
    }
    // fflate 由来の失敗 (壊れた deflate 列) と、想定外の例外 (項目数が多すぎる
    // ZIP での RangeError など) がここへ来る。利用者には意味の取れる文言に
    // 寄せるが、**元の失敗はログに残す** — 握り潰すと「壊れている」と
    // 「こちらの実装が限界に当たった」を切り分けられなくなる
    console.error('ZIP の展開に失敗しました:', error)
    throw new ZipReadError('ZIP を展開できませんでした (壊れている可能性があります)')
  }

  if (entries.length === 0 && signature === 'local') {
    // 先頭は ZIP なのに 1 件も出てこない = 途中で切れているか中身が壊れている。
    // 「0 件取り込めました」と報告すると、利用者は原因を探せない
    throw new ZipReadError('ZIP の中身を読み取れませんでした (途中で切れている可能性があります)')
  }

  return entries
}

function zipSignature(zip: Uint8Array): 'local' | 'empty' | null {
  if (startsWith(zip, LOCAL_FILE_HEADER)) {
    return 'local'
  }
  if (startsWith(zip, EMPTY_ARCHIVE) || startsWith(zip, SPANNED_ARCHIVE)) {
    return 'empty'
  }
  return null
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte)
}

function tooLargeInside(path: string): string {
  return `ZIP の中のファイルが大きすぎます (${path} / 上限 ${megabytes(MAX_ZIP_FILE_BYTES)}MB)`
}

function megabytes(bytes: number): number {
  return Math.round(bytes / 1024 / 1024)
}
