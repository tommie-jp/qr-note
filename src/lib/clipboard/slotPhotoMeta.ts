// 枠に置く前に、撮影情報を設定どおりに消す (docs/114 §11。2026-11 の監査 M-12)。
// **サーバ専用** (images/photoMeta の除去を呼ぶ)。
//
// メニューの「写真の撮影情報 (EXIF)」(docs/113) は添付の保存で効いていたが、枠は
// 原本のまま置いていた。枠のファイルは受け取った端末で保存・共有されるので、
// 「消す」を選んでいる人の位置・日時・機種が、本人の意図なく相手の端末へ渡った。
// 添付の保存 (attachments/storeImage.ts・storeVideo.ts) と同じ一手を同じ設定で
// 掛ける。「原本のまま送る」専用の切替は**作らない** — 設定の意味を 2 つにしない。
//
// HEIC・TIFF は呼ぶ前に JPEG へ変換されている (slotPrepare.ts) ので、ここには
// 素通しの 5 形式か動画で来る。それ以外 (PDF・テキスト・Office…) は触らない。
// 抜けなければ例外 — 呼ぶ側 (route) が断る (撮影情報が残ったまま置かない)

import 'server-only'
import { applyPhotoMeta, applyVideoMeta } from '../attachments/photoMeta'
import type { PhotoMetaMode } from '../prefs/photoMeta'
import type { VideoFormat } from '../uploads/sniff/video'
import type { SlotFile } from './slotFile'

// 枠の mime → 添付の保存名の拡張子 (applyPhotoMeta はそれで形式を見る)
const PHOTO_EXT_BY_MIME: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
}

// WebM はブラウザの録画でカメラが書かない (attachments/photoMeta.ts と同じ扱い)
const VIDEO_FORMAT_BY_MIME: Readonly<Record<string, VideoFormat>> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
}

export async function applySlotPhotoMeta(file: SlotFile, mode: PhotoMetaMode): Promise<SlotFile> {
  if (mode === 'keep') {
    return file
  }
  const ext = PHOTO_EXT_BY_MIME[file.mime]
  if (ext !== undefined) {
    return { ...file, data: await applyPhotoMeta(file.data, ext, mode) }
  }
  const format = VIDEO_FORMAT_BY_MIME[file.mime]
  if (format !== undefined) {
    return { ...file, data: applyVideoMeta(file.data, format, mode) }
  }
  return file
}
