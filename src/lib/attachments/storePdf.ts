// storeAttachment の PDF 分岐 (41-QR-search/docs/12-添付ファイル種類拡張メモ.md、
// docs/93-リファクタリング計画.md §4-5)。形式の判定と大きさの検査は store.ts が
// 済ませてから呼ぶ。
import 'server-only'
import { savePlainAttachment } from '@/lib/imageStore'
import { PDF_EXT, PDF_MIME } from '@/lib/uploads/names'
import { type AttachmentResult, succeed } from './result'

export async function storePdf(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<AttachmentResult> {
  // PDF もそのまま保存し、表示はブラウザ内蔵ビューアに任せる
  return succeed(await savePlainAttachment(bytes, PDF_MIME, PDF_EXT), false)
}
