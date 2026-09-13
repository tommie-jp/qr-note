// PDF ページを canvas に描くときの倍率計算 (41-QR-search/docs/12-添付ファイル種類拡張メモ.md)。
//
// pdfjs を読み込まずに検証できるよう、純粋な計算だけをここに置く
// (pdfjs は jsdom で動かないため、テストできる形に切り出しておく)。
//
// **なぜ上限が要るか**: canvas は幅 x 高さ x 4 バイトを実メモリで確保する。
// 高 DPR (iPhone は 3) をそのまま掛けると、A4 1 ページでも数十 MB になり、
// 数ページ分で iOS WebKit のメモリ上限に当たって描画が白紙になる。
// 画像の解凍爆弾よけ (images/thumbConfig.ts の MAX_INPUT_PIXELS) と同じ考え方で、
// 「入力がどうであれ確保量を縛る」ことを倍率の側で担保する。

// 1 ページの canvas に許す最大ピクセル数。
// iOS Safari は canvas の総ピクセル数がおおよそ 16.7M (4096x4096 相当) を
// 超えると描画に失敗するため、複数ページを同時に持てるよう更に低く取る。
// A4 (595x842pt) を幅 1000px で描くと約 1.4M px なので、実用上ここには当たらない。
export const MAX_CANVAS_PIXELS = 4_000_000

// 掛ける devicePixelRatio の上限。3 倍まで許すと canvas が 9 倍になるが、
// 文字の可読性は 2 倍でほぼ頭打ちなので、メモリを取りに行かない
export const MAX_DEVICE_PIXEL_RATIO = 2

// ページを「幅フィット + 高精細」で描くための倍率を返す。
//
// pageWidth / pageHeight は倍率 1 のときのページ寸法 (pdfjs の getViewport({scale:1}))。
// cssWidth は画面上で占めさせたい幅 (px)。
//
// 返す倍率は getViewport({ scale }) にそのまま渡す。canvas の CSS 幅は
// 呼び出し側が cssWidth に固定するので、倍率が上限で頭打ちになった場合は
// 「少しぼやけるが表示はされる」に収まる (描画が失敗するより良い)。
export function pageRenderScale(
  pageWidth: number,
  pageHeight: number,
  cssWidth: number,
  devicePixelRatio: number,
  maxPixels: number = MAX_CANVAS_PIXELS,
): number {
  // 寸法が壊れている PDF で 0 除算や NaN を返さない (呼び出し側は倍率を検算しない)
  if (!(pageWidth > 0) || !(pageHeight > 0) || !(cssWidth > 0)) {
    return 1
  }

  const fit = cssWidth / pageWidth
  // DPR は 1 未満 (縮小表示) でも 1 は確保する。下回らせても文字が潰れるだけ
  const dpr = Math.min(Math.max(devicePixelRatio, 1), MAX_DEVICE_PIXEL_RATIO)
  const desired = fit * dpr

  const pixels = pageWidth * desired * (pageHeight * desired)
  if (pixels <= maxPixels) {
    return desired
  }
  // 面積が上限に収まるところまで落とす (面積は倍率の 2 乗に比例)
  return desired * Math.sqrt(maxPixels / pixels)
}
