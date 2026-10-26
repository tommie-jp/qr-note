// 枠に置くときに作る見本 (docs/115-サーバクリップボードのサムネ計画.md §1-2)。**サーバ専用**
// (sharp を持つ makeThumbnail を呼ぶ)。
//
//   画像             … 長辺 384 の WebP の絵 (一覧のサムネと同じ makeThumbnail。アニメは動く)
//   テキストファイル … 先頭 4 行・300 字の抜粋 (中身は置く前に UTF-8 へ正規化済み)
//   Office (OOXML)   … 本文の抜粋 (officePreview.ts)
//   動画・PDF        … ここでは作らない。クライアントが描いて後から貼る (api/clipboard/thumb)
//   その他           … 見本なし (画面は拡張子の札を出す)
//
// **例外を投げない。** 見本は派生物で、作れなくても置くこと自体は止めない
// (makeThumbnail と同じ流儀)。HEIC・TIFF は prepareSlotFile で JPEG にした後の
// バイト列を渡すこと (変換前の HEIC は sharp が読めない)。

import 'server-only'
import { makeThumbnail } from '../images/thumbnail'
import { officePreview } from './officePreview'
import { kindOfMime, previewText } from './slot'

export interface SlotPreview {
  readonly thumb: Uint8Array<ArrayBuffer> | null
  readonly preview: string | null
}

// 抜粋のために読むテキストの長さ
const TEXT_SCAN_BYTES = 64 * 1024

const NONE: SlotPreview = { thumb: null, preview: null }

export async function makeSlotPreview(file: {
  readonly mime: string
  readonly data: Uint8Array
}): Promise<SlotPreview> {
  try {
    switch (kindOfMime(file.mime)) {
      case 'image':
        return { thumb: await makeThumbnail(file.data, 'clipboard'), preview: null }
      case 'textfile': {
        // 抜粋は先頭 4 行・300 字。10MB のファイルを丸ごと文字にしない
        const text = new TextDecoder().decode(file.data.subarray(0, TEXT_SCAN_BYTES))
        return { thumb: null, preview: text.trim() === '' ? null : previewText(text) }
      }
      case 'file':
        return { thumb: null, preview: officePreview(file.data, file.mime) }
      default:
        return NONE
    }
  } catch (error) {
    console.error(`クリップボードの見本を作れませんでした (${file.mime}):`, error)
    return NONE
  }
}
