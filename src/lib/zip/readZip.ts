// ZIP のバイト列を項目の並びに開く (docs/28-エクスポート計画.md §3)。
//
// **流しながら読む**のがこの層の要点。入口は 500MB まで許すので、素直に
// 「全部展開してから配列で返す」形にすると、入口のバイト列と展開後の中身の
// 両方が同時に載る (本番 VPS は RAM 2GB / swap 常用。docs/09)。ここは項目が
// 1 つ揃うたびに呼び出し側へ渡し、渡し終えたものは捨てる。
//
// **入力は必ず細切れに push する**。fflate の Unzip は項目ごとに再帰するため、
// 大きなバイト列を 1 回で push すると項目数に比例してスタックが深くなり、実測で
// 3500 件から `RangeError: Maximum call stack size exceeded` になる。64KB
// ずつ流し込めば 30000 件でも通ることを確かめた (この 1 行が上限を決めている
// ので、消さないこと)。
//
// 書き込み境界なので門も敷く。ZIP は「入口が小さくても出口が無限になりうる」
// 形式で (ZIP 爆弾)、門は 2 段:
//
//   1. ヘッダが展開後の大きさを名乗っているなら、**展開する前に**それで断る
//   2. 名乗っていないものは、出てきたバイト数を数えて上限で断つ
//
// **1 段目が本命で、2 段目は取りこぼしを拾うだけ**である点は正直に書いておく。
// fflate の UnzipInflate は 1 項目を 1 回の ondata でまとめて渡してくるため、
// 2 段目が火を噴く時点でその 1 項目ぶんの確保は済んでいる (実測: 80MB の項目は
// 80MB のチャンク 1 つで届き、入力を細切れに push しても変わらない)。つまり
// 2 段目が守るのは「積み上がり」であって「1 項目の山」ではない。
//
// それでも実害が小さいのは、この口がログイン必須の単独利用者向けで、1 項目の
// 上限が 30MB と小さく、確保に失敗しても RangeError を 400 に写して応答を
// 返せるため。**守れている範囲を過大に書かない**ことのほうが、後で読む人の
// 判断を助ける。

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

// fflate へ 1 回で渡す量。項目ごとの再帰を浅く保つための値で、
// **大きくしてはいけない** (上のコメント参照)
const PUSH_CHUNK_BYTES = 64 * 1024

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

// 項目が 1 つ揃うたびに呼ばれる。**呼び出し側が待たせられる**ように非同期。
// 戻ってきた時点でその項目のバイト列は捨ててよい (呼び出し側が抱えるなら、
// 抱える量は呼び出し側が縛る)。
export type ZipEntryHandler = (entry: RawZipEntry) => Promise<void>

// ZIP を流し読みして、項目ごとに handler を呼ぶ。
//
// **ファイルごと断る事情**は ZipReadError で投げる (ZIP として読めない・
// 大きすぎる・多すぎる)。個々のノートの良し悪しはここでは見ない
// (importZip.ts がレポートに載せる)。
export async function readZipStream(
  source: AsyncIterable<Uint8Array>,
  onEntry: ZipEntryHandler,
): Promise<void> {
  // 揃った項目の待ち行列。fflate の ondata は同期で飛ぶので await できない —
  // いったんここへ積み、push と push の間で掃き出す。1 回の push (64KB) で
  // 揃うのはせいぜい数件なので、積み上がることはない
  const ready: RawZipEntry[] = []
  let entryCount = 0
  let totalBytes = 0
  let signature: 'local' | 'empty' | null = null

  const unzip = new Unzip()
  unzip.register(UnzipInflate)
  unzip.onfile = (file) => {
    // ディレクトリ項目は中身を持たない。数にも入れない
    if (file.name.endsWith('/')) {
      return
    }
    entryCount += 1
    if (entryCount > MAX_ZIP_ENTRIES) {
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
        ready.push({ path, data: concatBytes(chunks, size) })
      }
    }
    file.start()
  }

  const drain = async () => {
    // shift ではなく先頭から取り出して都度捨てる。掃き出しの間に onfile が
    // 増やすことはない (push の外なので fflate は動いていない)
    while (ready.length > 0) {
      await onEntry(ready.shift() as RawZipEntry)
    }
  }

  for await (const chunk of source) {
    if (chunk.length === 0) {
      continue
    }
    if (signature === null) {
      // 最初のひとかたまりで中身を見極める。ここを通さないと、別のファイルを
      // 選んだときに「0 件取り込めました」で終わってしまう
      signature = zipSignature(chunk)
      if (signature === null) {
        throw new ZipReadError(
          'ZIP ファイルではありません (拡張子と中身が食い違っていないか確かめて下さい)',
        )
      }
    }
    for (let start = 0; start < chunk.length; start += PUSH_CHUNK_BYTES) {
      pushSafely(unzip, chunk.subarray(start, start + PUSH_CHUNK_BYTES), false)
    }
    await drain()
  }

  if (signature === null) {
    throw new ZipReadError('ファイルが空です')
  }
  // 締めだけ空で押す。中身は既に全部渡してあるので、ここは「終わり」の合図
  pushSafely(unzip, new Uint8Array(0), true)
  await drain()

  if (entryCount === 0 && signature === 'local') {
    // 先頭は ZIP なのに 1 件も出てこない = 途中で切れているか中身が壊れている。
    // 「0 件取り込めました」と報告すると、利用者は原因を探せない。
    // **項目 0 件の ZIP (署名が 'empty') は失敗にしない** — 空を取り込んで
    // 「0 件でした」と言うのは正しい振る舞い
    throw new ZipReadError(
      'ZIP の中身を読み取れませんでした (途中で切れている可能性があります)',
    )
  }
}

// fflate の投げる素の失敗を、こちらの言葉に写して投げ直す。
// **元の失敗はログに残す** — 握り潰すと「壊れている」と「こちらの実装が
// 限界に当たった」を切り分けられなくなる
function pushSafely(unzip: Unzip, chunk: Uint8Array, final: boolean): void {
  try {
    unzip.push(chunk, final)
  } catch (error) {
    if (error instanceof ZipReadError) {
      throw error
    }
    console.error('ZIP の展開に失敗しました:', error)
    throw new ZipReadError('ZIP を展開できませんでした (壊れている可能性があります)')
  }
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
