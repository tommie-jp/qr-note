// storeAttachment のテキスト分岐 (41-QR-search/docs/12-添付ファイル種類拡張メモ.md、
// docs/93-リファクタリング計画.md §4-5)。大きさの検査は store.ts が済ませてから呼ぶ。
// 署名が無いので、いつ試すか (UTF-16 BOM は音声より先、それ以外は最後) も store.ts が決める。
import 'server-only'
import { savePlainAttachment } from '@/lib/images/imageStore'
import { normalizeTextBytes } from '@/lib/text/normalizeText'
import { textSaveInfo } from '@/lib/uploads/sniff/text'
import { type AttachmentResult, succeed, UNSUPPORTED_ATTACHMENT_MESSAGE } from './result'

// テキストとして保存できるか試す。判定は 2 つとも通ったときだけ:
//   1. 名前が txt/csv/md であること (uploads/sniff/text.ts textSaveInfo)
//   2. 中身がテキストとして読めること (text/normalizeText.ts)
// 名前だけでは中身がバイナリのものを受けてしまい、中身だけでは HTML や SVG が
// 名前を偽ったまま通ってしまう。中身は UTF-8 へ正規化されて保存される。
//
// 戻り値の 3 通り:
//   - null      … 名前がテキストでない (= テキストではない。別形式に委ねる)
//   - ok: false … 名前は合うが中身を読めなかった (これ以上は試さない)
//   - ok: true  … 保存できた
export async function tryStoreText(
  bytes: Uint8Array<ArrayBuffer>,
  fileName: string | null | undefined,
): Promise<AttachmentResult | null> {
  const textInfo = textSaveInfo(fileName)
  if (!textInfo) {
    return null
  }
  const text = normalizeTextBytes(bytes)
  if (!text) {
    return { ok: false, reason: UNSUPPORTED_ATTACHMENT_MESSAGE }
  }
  return succeed(
    await savePlainAttachment(text, textInfo.mime, textInfo.ext),
    false,
  )
}
