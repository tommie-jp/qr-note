// デモインスタンスの総量クォータ (docs/39-デモ公開計画.md §2)。
//
// 再シードは毎時なので TTL はそれで足りるが、その間に数 GB 書き溜められる。
// 「ファイル置き場」化と桁違いの量産を止めるための上限を 2 つ持つ。
//
// ここは DB にも env にも触らない純粋な判定だけにする (uploads/limits.ts / appEnv.ts と
// 同じ流儀)。DB から合計・件数を取ってくるのは呼び出し側 (imageStore / items)、
// 「デモかどうか」で掛けるかを決めるのも呼び出し側。

// 添付 (画像・音声・PDF・テキスト) の総バイト数の上限。images テーブルは
// 全種別を bytea で持つので、SUM(octet_length(data)) 1 本で全部に効く。
export const DEMO_MAX_TOTAL_UPLOAD_BYTES = 200 * 1024 * 1024

// ノート数の上限。新規作成のときだけ見る (既存の更新は数に依らず通す)。
export const DEMO_MAX_ITEMS = 500

// いまの合計に incoming を足すと上限を超えるか。等しいときは超えない
// (ちょうど上限ぴったりまでは受ける)。
export function exceedsUploadQuota(currentBytes: number, incomingBytes: number): boolean {
  return currentBytes + incomingBytes > DEMO_MAX_TOTAL_UPLOAD_BYTES
}

// 新規ノートを 1 件足せないか。現在数が上限**以上**なら足せない
// (500 件あるなら 501 件目は作らせない)。
export function exceedsItemQuota(currentCount: number): boolean {
  return currentCount >= DEMO_MAX_ITEMS
}
