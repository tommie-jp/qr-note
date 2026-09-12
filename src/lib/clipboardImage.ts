// ノートの画像をクリップボードへ載せる (docs/92-クリップボード連携計画.md §3)。
// **クライアント専用**。
//
// iPhone で取り込んだ画像を Windows 側で取り出し、X の投稿欄などへ貼るための
// 出口。デスクトップの右クリック「画像をコピー」でも同じことはできるが、
// standalone の PWA には右クリックメニューが無く、iPhone の長押しも
// オーバーレイの中では出ないことがある。押せば必ず同じ結果になる口を 1 つ置く。

import { redrawImage } from './imageCanvas'

// クリップボードに載せる形式。**png 以外は入れられない** — Chrome の
// navigator.clipboard.write は image/png しか受けず、webp や jpeg を渡すと
// 「Type … not supported on write」で弾かれる。保存形式が何であれ png に直す
export const CLIPBOARD_IMAGE_TYPE = 'image/png'

// この画像にコピーボタンを出してよいか。
//
// **blob: には出さない。** ノートの中で blob: を持つ画像は、復号したシークレット
// 断片の中身 (docs/51-部分暗号化計画.md §3) — 平文そのものだ。断片は隠すときに
// URL.revokeObjectURL まで呼んで画素を残さないようにしているのに、その画像を
// OS のクリップボード (iOS の Universal Clipboard・Windows のクリップボード履歴・
// 同期先) へ 1 タップで送れる口を付けては元も子もない。
// 保存済みの添付は必ず /api/images/… なので、この規則で落ちることはない。
export function canCopyImage(src: string): boolean {
  return canWriteImage() && !src.startsWith('blob:')
}

// クリップボードへ画像を書ける環境か。secure context の外や古い Safari では
// ClipboardItem か clipboard.write のどちらかが欠ける
export function canWriteImage(): boolean {
  return (
    typeof ClipboardItem !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.clipboard?.write === 'function'
  )
}

// 描き直しが要るか (png ならそのまま載せられる)。
// 配信の Content-Type には charset が付きうるので、型名だけを見る
export function needsPngConversion(mime: string): boolean {
  return mime.split(';')[0].trim().toLowerCase() !== CLIPBOARD_IMAGE_TYPE
}

// 画像をクリップボードへ載せる。**ユーザー操作の同期部から呼ぶこと。**
//
// ClipboardItem は中身に Promise を取れる。この形にしておくと、器を作って
// write を呼ぶところまでが同期で済み、取得と変換はその中で待たせられる。
// 先に await して取得してから write を呼ぶと、Safari は「ユーザー操作の中では
// ない」として弾く (shareFile.ts の transient activation と同じ話)
//
// **async にしてあるのは投げ方を揃えるため。** `new ClipboardItem` も `write` も
// 同期で投げうる (ClipboardItem があっても promise 入りの item を受けるとは
// 限らない)。素の関数だと呼ぶ側の .catch が付く前に例外が飛び出し、ボタンが
// 「…」のまま固まる。async なら必ず reject として返る。中身は最初の await まで
// 同期に走るので、ユーザー操作の扱いは切れない
export async function copyImageToClipboard(src: string): Promise<void> {
  const png = pngBlobOf(src)
  // 器を作れずに終わったときの野良 rejection よけ。失敗そのものは下の write が
  // 同じ promise を待って返すので、握り潰しにはならない
  png.catch(() => {})
  const item = new ClipboardItem({ [CLIPBOARD_IMAGE_TYPE]: png })
  await navigator.clipboard.write([item])
}

async function pngBlobOf(src: string): Promise<Blob> {
  // 同一オリジンなので Cookie は既定で付く (認証つき配信もそのまま取れる)
  const res = await fetch(src)
  if (!res.ok) {
    throw new Error(`画像を取得できませんでした (HTTP ${res.status})`)
  }
  const blob = await res.blob()
  if (!needsPngConversion(blob.type)) {
    return blob
  }
  // 原寸のまま形式だけ変える。アニメ (GIF・アニメ WebP) はコマ 1 枚になる
  return redrawImage(blob, { type: CLIPBOARD_IMAGE_TYPE })
}
