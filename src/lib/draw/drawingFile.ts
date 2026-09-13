// お絵かきを画像として本文へ入れるときの名前と器の寸法 (docs/34-お絵かき計画.md §3)。
//
// 寸法の考え方: canvas の**論理サイズ**が、そのまま書き出す画像の解像度になる。
// 画面上の大きさは CSS で縮めて収める — fabric はポインタ座標を
// getBoundingClientRect と canvas.width の比で補正するので、CSS で縮めても
// 描き味はずれない。なので「表示に合わせて小さく作る」必要はなく、
// 解像度として十分な論理サイズを取ってよい。

import { timestampFileName, timestampLabel } from '../datetime'

// 書き出す画像の長辺の上限 —— であると同時に、**消しゴムの速さを決める値**。
// 消しゴムは 1 フレームに canvas 全体を 3 回描き直すので (docs/34 §3-2)、
// 器の画素数がそのまま体感の重さになる。2400px では実機で引っかかったため
// 白紙と同じ 1600px に揃えた。ノートの表示は 600px 程度、拡大表示でも画面幅
// なので、注釈付き写真として読める解像度は保てている。
// 10MB の投稿上限 (src/lib/uploads/limits.ts) にも余裕をもって収まる
export const MAX_DRAWING_EDGE = 1600

// 白紙の論理サイズ。表示領域の縦横比は活かしつつ、長辺をこの値に伸ばす
const BLANK_LONG_EDGE = 1600

// 表示領域を測れなかったときの白紙 (4:3 横)
const BLANK_FALLBACK = { width: 1600, height: 1200 } as const

export interface CanvasSize {
  readonly width: number
  readonly height: number
}

// 並べたときに時系列になる名前にする。サーバは保存時に UUID を振り直すので
// (src/lib/imageStore.ts)、この名前が残るわけではない — 送信時の File に
// 名前が要ることと、失敗時のログで何を送ったか判るようにするためのもの
export function drawingFileName(date: Date, extension: string): string {
  return timestampFileName('drawing', date, extension)
}

// 画像記法の alt に入れる説明。PDF がファイル名を alt に残すのと同じ狙いで、
// 本文に書いておけば PGroonga の全文検索から「お絵かき」で引ける。
// `]` `|` と改行は記法そのもの (と幅指定 `![alt|200]`) を壊すので使わない。
// 日時は分まで (録音・録画は秒まで)
export function drawingAltText(date: Date): string {
  return timestampLabel('お絵かき', date, 'minute')
}

// 既にある画像に描くときの器。元の画素を保ったまま、長辺だけ上限に収める。
// 小さい画像は引き伸ばさない (ぼけた絵に描いても嬉しくない)
export function canvasSizeForImage(
  naturalWidth: number,
  naturalHeight: number,
  maxEdge: number = MAX_DRAWING_EDGE,
): CanvasSize {
  if (!(naturalWidth > 0) || !(naturalHeight > 0)) {
    return BLANK_FALLBACK // 寸法を読めない画像でも、描ける器は返す
  }
  const scale = Math.min(1, maxEdge / Math.max(naturalWidth, naturalHeight))
  return {
    width: Math.max(1, Math.round(naturalWidth * scale)),
    height: Math.max(1, Math.round(naturalHeight * scale)),
  }
}

// 白紙の器。表示領域の縦横比のまま、長辺を BLANK_LONG_EDGE に合わせる
export function blankCanvasSize(availableWidth: number, availableHeight: number): CanvasSize {
  const longEdge = Math.max(availableWidth, availableHeight)
  if (!(longEdge > 0)) {
    return BLANK_FALLBACK
  }
  const scale = BLANK_LONG_EDGE / longEdge
  return {
    width: Math.max(1, Math.round(availableWidth * scale)),
    height: Math.max(1, Math.round(availableHeight * scale)),
  }
}
