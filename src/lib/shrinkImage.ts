// 上限に収まらない画像を、送る前に描き直して小さくする
// (docs/92-クリップボード連携計画.md §4)。**クライアント専用**。
//
// **クリップボード由来の画像のためにある。** iOS は写真をコピーすると PNG で
// 渡してくることが多く、12MP の写真は PNG になるだけで 20〜30MB になる。元は
// 3MB の JPEG でも、形式が変わっただけで MAX_IMAGE_BYTES (10MB) を超えて
// 「大きすぎます」で止まる。OS が作り直した写しであって**ユーザーが選んだ原本
// ではない**ので、ここで描き直しても失われるものは無い。
//
// ファイル選択・ドラッグ&ドロップには掛けない。そちらはユーザーが原本を
// 指しているので、黙って再圧縮するより上限を理由に断るほうが正直。

import { redrawImage } from './imageCanvas'

// 長辺の上限。ノートに貼って読む用途では十分で、12MP の写真がおよそ 1MB 未満の
// JPEG に収まる (上限 10MB に対して十分な余裕)
const MAX_EDGE = 2048

// 書き出す形式。**WebP にしない** — iOS の canvas は WebP を書き出せず、黙って
// PNG を返す。それでは縮めた意味が薄れる (uploads/sniff/video.ts の poster 検証と同じ罠)
const OUT_TYPE = 'image/jpeg'
const OUT_EXT = 'jpg'
const QUALITY = 0.85

// JPEG は透過を持てない。下地を敷かないと透明部分が黒く沈むので白で埋める
const BACKGROUND = '#ffffff'

// 描き直しても意味を失わない画像か。
//
// GIF を外すのは、canvas に描くとコマ 1 枚の静止画になるため。動くものを黙って
// 止めるくらいなら「大きすぎます」で断るほうがよい (アニメ WebP も同じ理屈だが、
// 静止 WebP と MIME で区別できないので諦める。GIF は必ず動くとは限らないが、
// 動くほうに賭けて外す)
export function canShrink(file: File): boolean {
  const mime = file.type.toLowerCase()
  return mime.startsWith('image/') && mime !== 'image/gif'
}

// 書き出す形式に合わせて拡張子を差し替える。
//
// 保存名はサーバが中身を見て発番する (attachmentStore) ので、この名前が保存先を
// 決めることはない。効くのは**人の目に触れるところ**だけ — 縮めても収まらな
// かったときの断り文に出るファイル名で、中身が JPEG なのに .png と言われると
// 何を測ったのか分からなくなる
export function shrunkFileName(name: string): string {
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  return `${base}.${OUT_EXT}`
}

// 長辺 MAX_EDGE の JPEG に描き直す。呼ぶ側は canShrink を先に確かめること
export async function shrinkImageFile(file: File): Promise<File> {
  const blob = await redrawImage(file, {
    type: OUT_TYPE,
    quality: QUALITY,
    maxEdge: MAX_EDGE,
    background: BACKGROUND,
  })
  return new File([blob], shrunkFileName(file.name), { type: blob.type })
}
