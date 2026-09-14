// お絵かきの canvas の寸法換算と書き出し (docs/34-お絵かき計画.md §3)。
//
// canvas の**論理サイズ**が書き出す画像の解像度で、画面には CSS で縮めて
// 出している。ユーザーが選ぶ太さ・文字の大きさは画面で見た px なので、
// 論理 px へ直す計算をここに集める。fabric は触らない — canvas 要素も
// toBlob を持つものとしてだけ受け取る (テストで差し替えられるように)。

import type { CanvasSize } from './drawingFile'
import {
  MAX_DISPLAY_SCALE,
  MIN_DISPLAY_SCALE,
  WEBP_QUALITY,
} from './drawCanvasConst'

// 画面で見た px を canvas の論理 px に直す。1600px の写真を幅 400px で表示して
// いるなら 6px の線は 24 論理 px —— これをしないと、大きな画像に描いた線が
// 髪の毛のように細くなる。0 除算と、測る前の 0 を避けて下限を敷く
export function toCanvasUnits(screenPixels: number, displayScale: number): number {
  return screenPixels / Math.max(displayScale, MIN_DISPLAY_SCALE)
}

// 論理サイズを表示領域に収める倍率。canvas 全体が見えていないと
// 描いた端が確かめられないので、幅と高さの両方を満たす方に合わせる。
// 準備前 (size が null) や測る前 (0) は 1 のまま
export function fitDisplayScale(
  size: CanvasSize | null,
  availableWidth: number,
  availableHeight: number,
): number {
  const isMeasured = size !== null && availableWidth > 0 && availableHeight > 0
  return isMeasured
    ? Math.min(
        availableWidth / size.width,
        availableHeight / size.height,
        MAX_DISPLAY_SCALE,
      )
    : 1
}

// canvas.toBlob を Promise にする。作れなければ null
export function toBlob(
  canvas: Pick<HTMLCanvasElement, 'toBlob'>,
  type: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

export interface EncodedDrawing {
  blob: Blob
  extension: string
}

// 書き出しは WebP を第一候補にし、駄目なら PNG へ落とす
export async function encodeDrawing(
  canvas: Pick<HTMLCanvasElement, 'toBlob'>,
): Promise<EncodedDrawing> {
  const webp = await toBlob(canvas, 'image/webp', WEBP_QUALITY)
  if (webp && webp.type === 'image/webp') {
    return { blob: webp, extension: 'webp' }
  }
  // WebP を書き出せないブラウザは PNG へ落とす (toBlob は非対応の形式を
  // 黙って PNG にすることがあるので、type を見てから決める)
  const png = await toBlob(canvas, 'image/png')
  if (!png) {
    throw new Error('お絵かきを画像にできませんでした。')
  }
  return { blob: png, extension: 'png' }
}
