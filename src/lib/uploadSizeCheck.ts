// 添付を送る**前に**ブラウザ側で行う大きさの検査。
//
// なぜサーバの応答だけに任せないのか: 上限を超えたファイルは、サーバが返す
// JSON エラー ("ファイルが大きすぎます") がブラウザまで届かないことがある。
//
//   - エッジ (Caddyfile / deploy/nginx の 35MB) を超えると、そこで本文を
//     読み捨てられて送信中に接続が切れたように見える。
//   - Next.js の proxy を通る本文は experimental.proxyClientMaxBodySize で
//     途中まで**黙って**しか複製されず、route には千切れた multipart が届く
//     (next.config.ts の同項の注)。
//
// どちらも XHR には「通信エラー」や「multipart の書き方が悪い」としか出ず、
// 本当の理由 (大きすぎた) がどこにも出ない。理由を言葉で出すには送る前に
// 見るしかない — ENEX 取り込み (enex/limits.ts) が同じ理由でクライアント側の
// 検査を持っているのと同じ話である。
//
// **デモインスタンスの縮んだ上限 (2MB) はここでは見ない。** DEMO_MODE は
// NEXT_PUBLIC_ ではないのでクライアントに渡らない。デモで超えたものは
// サーバの 400 (uploads.ts の tooLargeMessage) が断り、デモのエッジ上限は
// 3MB あるのでその JSON はちゃんと届く。

import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, megabytesLabel } from './uploads'

// 送る前に当てる 1 ファイルの上限。動画だけ別枠で大きいのはサーバと同じ
// (uploads.ts の MAX_VIDEO_BYTES / MAX_IMAGE_BYTES がそのまま正本)。
// 種別の判定はクライアントの申告 (MIME・拡張子) でよい — ここは「送る前に
// 気づかせる」ための予選で、実体を見た最終判定は attachmentStore が行う。
export function uploadSizeLimit(isVideo: boolean): number {
  return isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES
}

// 大きすぎるなら理由の文、収まっていれば null。
export function uploadTooLargeMessage(
  file: { name: string; size: number },
  isVideo: boolean,
): string | null {
  const limit = uploadSizeLimit(isVideo)
  // 「超えたら」で断る。サーバ側 (route.ts の file.size > maxUploadBytes())
  // と境界の向きを揃えないと、送る前に断ったものがサーバでは通ってしまう
  if (file.size <= limit) {
    return null
  }
  // 実サイズは小数 1 桁 (どれだけ超えたか分かるように)、上限は整数
  // (megabytesLabel = サーバの断り文と同じ数)。並べ方は enex/limits.ts・
  // zip/limits.ts の言い回しと揃える
  const actual = (file.size / 1024 / 1024).toFixed(1)
  // ペーストした画像や録画には名前が付かないことがある。空の名前をそのまま
  // 文に埋めると「 は大きすぎます」と壊れて見えるので、言い回しごと替える
  const label = file.name.trim()
  const subject = label === '' ? 'ファイルが大きすぎます' : `${label} は大きすぎます`
  return `${subject} (${actual}MB / 上限 ${megabytesLabel(limit)})`
}
