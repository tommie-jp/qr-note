// ラスタ道具 (塗りつぶし・モザイク) の範囲の計算 (docs/35-塗りつぶし計画.md §3、
// docs/36-お絵かき拡張計画.md §3-2)。
//
// 囲んだ矩形を canvas の中へ収め、その範囲の画素を切り出す。ここは画素の配列と
// 数の計算だけで、canvas も fabric も触らない — 画素の読み書きと FabricImage
// への変換は src/components/draw/rasterTool.ts が行う (docs/96 §3-2 で切り出した)。

import type { FillBounds, RgbaImage } from './floodFill'
import type { DragRect } from './shapes'

// ドラッグした矩形を canvas の中へ収め、整数の画素位置に直す。
// はみ出したまま切り出すと getImageData の範囲外になる
export function clampToCanvas(rect: DragRect, image: RgbaImage): FillBounds | null {
  const left = Math.max(0, Math.floor(rect.left))
  const top = Math.max(0, Math.floor(rect.top))
  const right = Math.min(image.width, Math.ceil(rect.left + rect.width))
  const bottom = Math.min(image.height, Math.ceil(rect.top + rect.height))
  if (right - left < 1 || bottom - top < 1) {
    return null
  }
  return { left, top, width: right - left, height: bottom - top }
}

export function cropImage(image: RgbaImage, bounds: FillBounds): RgbaImage {
  const data = new Uint8ClampedArray(bounds.width * bounds.height * 4)
  for (let y = 0; y < bounds.height; y += 1) {
    const from = ((y + bounds.top) * image.width + bounds.left) * 4
    data.set(image.data.subarray(from, from + bounds.width * 4), y * bounds.width * 4)
  }
  return { data, width: bounds.width, height: bounds.height }
}
