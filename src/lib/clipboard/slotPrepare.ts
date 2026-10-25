// 枠に置く前の変換 (docs/114-サーバクリップボード計画.md)。**サーバ専用**
// (sharp と HEIC 復号を持つ画像変換を呼ぶ)。
//
// 受け取る側 (Windows の Chrome など) や、枠から取り出して貼る先のアプリが読めない
// 写真だけを変換する。HEIC (iPhone の「高効率」) と TIFF がそれで、JPEG にする。
// JPEG・PNG・GIF・WebP・AVIF は触らない (ブラウザが読め、受け取るときに PNG へ描き直せる)。
// 動画・音声・PDF・テキストは変換しない。
//
// 変換に失敗する = 壊れた画像。呼ぶ側 (route) が 400 にする

import 'server-only'
import { normalizeImageForTransfer } from '../images/normalizeImage'
import type { ImageFormat } from '../uploads/sniff/image'
import type { SlotFile } from './slotFile'

const CONVERT_FORMAT_BY_MIME: Readonly<Record<string, ImageFormat>> = {
  'image/heic': 'heic',
  'image/tiff': 'tiff',
}

export async function prepareSlotFile(file: SlotFile): Promise<SlotFile> {
  const format = CONVERT_FORMAT_BY_MIME[file.mime]
  if (format === undefined) {
    return file
  }
  const converted = await normalizeImageForTransfer(file.data, format)
  return { ...file, mime: converted.mime, data: converted.bytes }
}
