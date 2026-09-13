// --- PDF (41-QR-search/docs/12-添付ファイル種類拡張メモ.md) ---
//
// PDF も音声と同じく変換もサムネも埋め込みもせず、images テーブルへそのまま
// 保存する。表示はブラウザ内蔵ビューアに任せ (本文にはリンクだけ出す)、
// 配信は音声と同じ経路 (Content-Type + Range) をそのまま使う。
//
// 保存する mime / 拡張子 (PDF_MIME / PDF_EXT) と保存名の規則は names.ts が持つ
// (docs/93-リファクタリング計画.md §4-2)。

import { startsWith } from './bytes'

// PDF は先頭が "%PDF-" (25 50 44 46 2D)。仕様上ヘッダは先頭 1KB 以内に
// あればよいが、ポリグロット (先頭が別形式に見える PDF) を避けるため
// offset 0 固定で見る (画像の署名判定と同じ厳しさ)。
export function sniffPdf(bytes: Uint8Array): boolean {
  return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])
}
