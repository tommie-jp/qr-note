// クリップボードの中身から、ノートに入れられるものを 1 つ選ぶ
// (docs/92-クリップボード連携計画.md §4)。
//
// navigator.clipboard.read() は「1 つのコピー」を複数の形式で返す。写真を
// コピーすると image/png と image/jpeg の両方が入っていたり、ブラウザから
// コピーすると text/html と text/plain が並んだりする。どれを採るかの規則を
// **ここだけに**置き、DOM に触らない形にしてある (呼ぶ側は取得と挿入だけ)。

import { timestampFileName } from '../datetime'
import { errorText } from '../errorMessage'
import { extForMime } from '../uploads/names'

// クリップボードに載せる形式として最も素直なもの。iOS のスクリーンショットも
// Windows の「画像をコピー」もこれで来る
const PREFERRED_IMAGE_TYPE = 'image/png'

const TEXT_TYPE = 'text/plain'

// 形式が判らない画像に付ける拡張子。中身の判定はサーバ (sniffImageFormat) が
// 行うので、ここは名前として体裁が整っていればよい
const FALLBACK_EXT = 'png'

// ClipboardItem のうち、この関数が見る部分だけ。本物を型に取ると node の
// テストで作れない (ClipboardItem はブラウザにしかない)
export interface ClipboardEntry {
  readonly types: readonly string[]
  getType(type: string): Promise<Blob>
}

export interface ClipboardPick {
  kind: 'image' | 'text'
  // 実際に getType へ渡す形式
  type: string
  entry: ClipboardEntry
}

// **画像を文字より先に見る。** 画像をコピーすると、その出所 (ファイル名や
// 画像の URL) を text/plain として一緒に載せるアプリがあり、文字を先に見ると
// 画像のつもりが URL の文字列だけ入ってしまう
export function pickClipboardEntry(
  entries: readonly ClipboardEntry[],
): ClipboardPick | null {
  return pickImage(entries) ?? pickText(entries) ?? null
}

function pickImage(entries: readonly ClipboardEntry[]): ClipboardPick | null {
  // png を優先する。同じ絵が複数形式で載っているとき、png なら描き直さずに
  // そのまま送れる (jpeg しか無ければそれを使う)
  const png = entries.find((e) => e.types.includes(PREFERRED_IMAGE_TYPE))
  if (png) {
    return { kind: 'image', type: PREFERRED_IMAGE_TYPE, entry: png }
  }
  for (const entry of entries) {
    const type = entry.types.find((t) => t.startsWith('image/'))
    if (type !== undefined) {
      return { kind: 'image', type, entry }
    }
  }
  return null
}

function pickText(entries: readonly ClipboardEntry[]): ClipboardPick | null {
  // text/html は採らない。ノートは markdown なので、貼るなら素の文字がよい
  const entry = entries.find((e) => e.types.includes(TEXT_TYPE))
  return entry ? { kind: 'text', type: TEXT_TYPE, entry } : null
}

// 取り込んだ画像に付ける名前。UUID を発番するのはサーバなので、ここでは
// 「いつクリップボードから入れたか」が判ればよい
export function clipboardFileName(mime: string, at: Date = new Date()): string {
  return timestampFileName('clipboard', at, extForMime(mime) ?? FALLBACK_EXT)
}

// read() が投げたものを画面に出す文にする。
//
// 断られた (NotAllowedError) ときは**理由を言い換える**。DOMException の素の
// メッセージは環境で違ううえ英語で、しかも「読み取りを許可しなかった」以外の
// 意味に読めることがある。iOS ではペーストの吹き出しを閉じただけでもここに来る
export function clipboardReadErrorMessage(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: string }).name === 'NotAllowedError'
  ) {
    return 'クリップボードの読み取りが許可されませんでした'
  }
  return errorText(error)
}
