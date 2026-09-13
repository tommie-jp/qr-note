// アップロードの大きさの上限と、その断り文句 (docs/93-リファクタリング計画.md §4-2)。
//
// 録画 (video/videoRecorder)・投稿前の事前チェック (uploadSizeCheck)・動くサムネ
// (video/videoAnim)・シークレット (secretPayload / secretRoute) はこれだけを欲しがる
// ので、形式の判定 (sniff/) や保存名の規則 (names.ts) から切り離して置く。
//
// **依存は appEnv (副作用なし) の相対 import だけに保つ。** next.config.ts が
// proxyClientMaxBodySize を導くためにこのファイルを読む (同ファイルの注)。
// クライアントからも読むので server-only も付けない。

import { isDemoMode } from '../appEnv'

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

// 動画だけは別枠で大きい上限を持つ (41-QR-search/docs/14-動画挿入計画.md)。3 分・720p・
// 映像 1Mbps + 音声 64kbps で約 24MB になるため、余裕を見て 30MB。画像・音声・
// PDF・テキストは従来どおり MAX_IMAGE_BYTES (10MB) のまま — 動画以外を大きく
// する理由はないので、種別で上限を分ける (判定は attachments/store.ts が中身を見て)。
export const MAX_VIDEO_BYTES = 30 * 1024 * 1024

// デモインスタンスでの 1 ファイル上限 (docs/38-デモモード計画.md §5)。
// guest に書き込みを許す代わりに縮める。総量クォータは別計画だが、
// 1 枚を小さくするだけでも「ファイル置き場」化をだいぶ抑えられる。
// 動画はデモでは扱わない (2MB では成立しない。録画ボタンも出さない)。
export const DEMO_MAX_IMAGE_BYTES = 2 * 1024 * 1024

// リクエスト全体で受け入れうる 1 ファイルの上限 (= 全種別の最大)。
// checkUploadRequest の Content-Length 事前チェックと route の申告サイズ検査が
// 使う「本文を読む前の門」。動画が最大なので非デモでは MAX_VIDEO_BYTES に開く。
// **種別ごとの上限はこの後 attachments/store.ts が中身を見て絞る** (動画 30MB /
// それ以外 10MB)。定数ではなく関数にするのは DEMO_MODE を起動時 env で切り替える
// ため (テストも env で差せる)。デモでは動画を扱わないので従来の 2MB のまま。
export function maxUploadBytes(): number {
  return isDemoMode() ? DEMO_MAX_IMAGE_BYTES : MAX_VIDEO_BYTES
}

// 動画以外 (画像・音声・PDF・テキスト) の 1 ファイル上限。デモでは 2MB。
// attachments/store.ts がスニッフ後にこの値で絞る (route はこれを渡す)。
export function maxAttachmentBytes(): number {
  return isDemoMode() ? DEMO_MAX_IMAGE_BYTES : MAX_IMAGE_BYTES
}

// 動画サムネ (poster) の上限。大きさは 200KB を超えないものだけ (バッファ済みの
// 防波堤は route 側にもある)。形式の判定と合わせた検査は sniff/video.ts の
// isValidVideoThumb
export const MAX_VIDEO_THUMB_BYTES = 200 * 1024

// 「動くサムネ」(docs/72-動画アニメサムネ計画.md) のためにクライアントが送る
// コマ数の上限。抽出も送信も 1 コマぶんずつ増えるので、増やすほど録画直後の
// 待ち時間と本文サイズが伸びる。8 コマ x 400ms で約 3.2 秒の紙芝居になる。
export const MAX_VIDEO_ANIM_FRAMES = 8

// コマ 1 枚の上限バイト。クライアントは 320px の JPEG を出すので実測 15〜30KB
// で収まり、80KB はその余裕分。
//
// **合計が multipart のオーバーヘッド枠 (MULTIPART_OVERHEAD_BYTES = 1MB) に
// 収まる大きさにしてある**のが要点。8 x 80KB + poster 200KB = 840KB なので、
// コマを足しても checkUploadRequest の Content-Length 検査 (動画本体の上限 +
// 1MB) に当たらない。ここを緩めるならあちらも一緒に見直すこと。
export const MAX_VIDEO_ANIM_FRAME_BYTES = 80 * 1024

// multipart のヘッダ等のオーバーヘッド分を上限に足す
export const MULTIPART_OVERHEAD_BYTES = 1024 * 1024

// 上限を「30MB」の形にする。断り方は場所によって違う (言い切る / 可能性を言う /
// 実サイズと並べる) が、**出す数は 1 つの計算から出す** — 同じ上限が画面ごとに
// 違う数で出ると、どれが本当か分からなくなる
export function megabytesLabel(maxBytes: number): string {
  return `${Math.round(maxBytes / 1024 / 1024)}MB`
}

export function tooLargeMessage(maxBytes: number = MAX_IMAGE_BYTES): string {
  return `ファイルが大きすぎます (最大 ${megabytesLabel(maxBytes)})`
}
