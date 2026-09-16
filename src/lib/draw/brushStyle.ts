// ブラシに道具ごとの太さと色を当てる (docs/34-お絵かき計画.md §3-2、
// docs/36-お絵かき拡張計画.md §2)。
//
// 太さは内容の大きさなので fitScale で割る (拡大しても論理サイズは変えない)。
// fabric は型でしか触らず、PencilBrush を canvas 無しで作って単体テストで
// 固定できる (docs/96 §3-2 で切り出した)。ブラシの持ち替え (道具が変わった
// ときの作り直し・消しゴムの解放) は src/components/draw/useFabricBrush.ts

import type * as fabric from 'fabric'
// 型だけ。実行時の依存は無い (道具の一覧は部品側に置いてある)
import type { DrawTool } from '@/components/draw/drawTools'
import { toCanvasUnits } from './canvasUnits'
import { markerColor } from './drawColor'
import { ERASER_SCALE, MARKER_SCALE, MIN_ERASER_WIDTH } from './drawCanvasConst'

export interface BrushStyle {
  tool: DrawTool
  color: string
  width: number
  fitScale: number
}

// ブラシに道具ごとの太さと色を当てる。太さは内容の大きさなので fitScale で割る
// (拡大しても論理サイズは変えない)
export function styleBrush(
  brush: fabric.BaseBrush,
  { tool, color, width, fitScale }: BrushStyle,
): void {
  if (tool === 'eraser') {
    // 消しゴムに色は無い (下を消すだけ)
    brush.width = toCanvasUnits(Math.max(MIN_ERASER_WIDTH, width * ERASER_SCALE), fitScale)
    return
  }
  if (tool === 'marker') {
    brush.width = toCanvasUnits(width * MARKER_SCALE, fitScale)
    brush.color = markerColor(color)
    return
  }
  brush.width = toCanvasUnits(width, fitScale)
  brush.color = color
}
