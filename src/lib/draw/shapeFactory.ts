// ドラッグで置く図形の生成 (docs/36-お絵かき拡張計画.md §1)。
//
// 始点・終点・色・太さから fabric の Rect・Ellipse・Path を作る。幾何の計算は
// shapes.ts、canvas へのイベントの取り付けは src/components/draw/shapeTool.ts。
// fabric のオブジェクトは DOM 無しで作れるので、道具ごとの座標と線を
// 単体テストで固定できる (docs/96 §3-2 で切り出した)。

// fabric はブラウザ向け。サーバの束に混ざらないよう境界を明示する
import 'client-only'
import * as fabric from 'fabric'
// 型だけ。実行時の依存は無い (道具の一覧は部品側に置いてある)
import type { DrawTool } from '@/components/draw/drawTools'
import {
  arrowGeometry,
  arrowPathData,
  type DrawPoint,
  normalizeDragRect,
  strokeCenteredRect,
} from './shapes'

// 囲んだ範囲を見せるだけの仮の矩形。確定時には捨てるので、見えれば足りる
export const REGION_PREVIEW_FILL = 'rgba(0, 0, 0, 0.4)'

// 図形はドラッグで置くので、置いた直後に掴めてしまうと次のドラッグの邪魔に
// なる。選択は「選択」道具に切り替えたときだけ有効になる (useDrawCanvas)
export const SHAPE_DEFAULTS = {
  // **fabric v7 の originX/originY の既定は center/center** (v7 の破壊的変更)。
  // 明示しないと left/top が「中心」と解釈され、図形が幅・高さの半分だけ
  // 左上へずれて描かれる (ドラッグとまったく別の場所に出る)。
  // Path (矢印) だけは座標を path データから決めるので影響を受けない —
  // 「矢印は合うのに四角・丸はズレる」の正体がこれ
  originX: 'left',
  originY: 'top',
  // 枠は線だけ。fabric の既定は黒の塗りつぶしなので、明示して外す
  // (PencilBrush が作る Path と同じ流儀で null を使う)
  fill: null,
  selectable: false,
  evented: false,
  erasable: true,
  strokeLineCap: 'round',
  strokeLineJoin: 'round',
} as const

export function createShape(
  tool: DrawTool,
  from: DrawPoint,
  to: DrawPoint,
  color: string,
  strokeWidth: number,
): fabric.FabricObject | null {
  const common = { ...SHAPE_DEFAULTS, stroke: color, strokeWidth }

  if (tool === 'arrow') {
    return new fabric.Path(arrowPathData(arrowGeometry(from, to, strokeWidth)), common)
  }

  const rect = normalizeDragRect(from, to)
  if (rect.width === 0 && rect.height === 0) {
    return null
  }
  if (tool === 'mosaic') {
    // 隠す範囲を見せるだけの仮表示。確定時に捨てて、画素を加工した
    // 画像に差し替える。処理される範囲 (onRegion に渡る rect) と
    // 見た目が一致するよう、ストロークは持たせない — fabric は
    // strokeWidth (既定 1) を stroke が無くても寸法に数える
    return new fabric.Rect({
      ...SHAPE_DEFAULTS,
      ...rect,
      fill: REGION_PREVIEW_FILL,
      stroke: undefined,
      strokeWidth: 0,
    })
  }
  // fabric の left/top は「ストロークを含む見た目の箱」の角なので、
  // 線の中心がドラッグ矩形に乗るよう半太さぶん戻す (ペン・矢印と同じ意味)
  const aligned = strokeCenteredRect(rect, strokeWidth)
  if (tool === 'rect') {
    return new fabric.Rect({ ...common, ...aligned })
  }
  if (tool === 'ellipse') {
    // Ellipse は左上と半径で持つ。ドラッグ矩形に内接させる
    return new fabric.Ellipse({
      ...common,
      left: aligned.left,
      top: aligned.top,
      rx: rect.width / 2,
      ry: rect.height / 2,
    })
  }
  return null
}
