// ZIP 復元の入口 (docs/93-リファクタリング計画.md §4-5)。新規保存の入口は store.ts。
import 'server-only'
import { restoreAttachmentRow } from '@/lib/images/imageStore'
import { normalizeTextBytes } from '@/lib/text/normalizeText'
import { tooLargeMessage } from '@/lib/uploads/limits'
import {
  isValidAudioName,
  isValidImageName,
  isValidPdfName,
  isValidVideoName,
  mimeForName,
  PDF_EXT,
  PDF_MIME,
} from '@/lib/uploads/names'
import { audioSaveInfo, sniffAudioFormat } from '@/lib/uploads/sniff/audio'
import { sniffImageFormat } from '@/lib/uploads/sniff/image'
import { sniffPdf } from '@/lib/uploads/sniff/pdf'
import { textSaveInfo } from '@/lib/uploads/sniff/text'
import { sniffVideoFormat, videoSaveInfo } from '@/lib/uploads/sniff/video'
import { MAX_ZIP_FILE_BYTES } from '@/lib/zip/limits'
import { mismatch, type RestoreResult, UNSUPPORTED_ATTACHMENT_MESSAGE } from './result'

// 書き出した ZIP の添付を**元の保存名のまま**戻す
// (docs/28-エクスポート計画.md §3)。
//
// storeAttachment との違いは「何で形式を決めるか」。アップロードは名前が
// 利用者由来なので**中身だけ**で決めるが、こちらの名前はこの DB が発番した
// UUID + 拡張子で、本文の参照がその名前を指している。そこで
// **拡張子が名乗る形式を、中身が裏付けるか**を見る形にする。順に試す
// storeAttachment と違って判定順の綾 (UTF-16 の BOM を MP3 と読む等) が
// 出ないぶん、こちらのほうが素直になる。
//
// 名乗りと中身が食い違うものは断る。ZIP は書き手が自由に作れるので、
// 「.png という名前の HTML」を保存して配信させない (配信側は DB の mime を
// そのまま Content-Type にする)。
export async function restoreAttachment(
  name: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<RestoreResult> {
  const ext = name.slice(name.lastIndexOf('.') + 1)

  // 上限は種別で分けず「DB に入りうる最大」(MAX_ZIP_FILE_BYTES = CLI 取り込みの
  // 添付上限と同値) の 1 本にする。Web アップロードの 10MB/30MB は HTTP の
  // 都合であって器の上限ではなく、CLI から入った 12MB の写真を復元で弾くと
  // 「書き出せるのに戻せない」ができてしまう (実測で踏んだ)
  if (bytes.byteLength > MAX_ZIP_FILE_BYTES) {
    return { ok: false, reason: tooLargeMessage(MAX_ZIP_FILE_BYTES) }
  }

  if (isValidVideoName(name)) {
    const format = sniffVideoFormat(bytes)
    const info = format === null ? null : videoSaveInfo(format)
    return info === null || info.ext !== ext
      ? mismatch(ext)
      : restoreRow(name, bytes, info.mime)
  }

  if (isValidImageName(name)) {
    // heic/tiff は保存時に WebP へ変換されるので、その名前は発番されない。
    // 中身が heic のまま来たらここで食い違いとして落ちる。
    // 拡張子が一致した時点で mime は必ず引ける (どちらも MIME_TO_EXT が出どころ)
    const mime = sniffImageFormat(bytes) === ext ? mimeForName(name) : null
    return mime === null ? mismatch(ext) : restoreRow(name, bytes, mime)
  }

  if (isValidAudioName(name)) {
    const format = sniffAudioFormat(bytes)
    const info = format === null ? null : audioSaveInfo(format)
    return info === null || info.ext !== ext
      ? mismatch(ext)
      : restoreRow(name, bytes, info.mime)
  }

  if (isValidPdfName(name)) {
    return sniffPdf(bytes) ? restoreRow(name, bytes, PDF_MIME) : mismatch(PDF_EXT)
  }

  // 名前が txt/csv/md なら textSaveInfo は必ず引ける (同じ一覧が出どころ)。
  // 中身がテキストとして読めるかだけが残りの条件
  const textInfo = textSaveInfo(name)
  if (textInfo !== null) {
    const text = normalizeTextBytes(bytes)
    return text === null ? mismatch(ext) : restoreRow(name, text, textInfo.mime)
  }

  return { ok: false, reason: UNSUPPORTED_ATTACHMENT_MESSAGE }
}

// サムネを作るかは imageStore が決める (画像の行を作る入口はあちらの 3 つだけ)
async function restoreRow(
  name: string,
  bytes: Uint8Array<ArrayBuffer>,
  mime: string,
): Promise<RestoreResult> {
  return { ok: true, created: await restoreAttachmentRow(name, bytes, mime) }
}
