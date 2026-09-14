// お絵かきの canvas の見た目と手触りを決める定数 (docs/34-お絵かき計画.md §3)。
//
// useDrawCanvas とその部品 (ブラシ・文字・選択枠) が共有する。値だけを持ち、
// fabric も DOM も触らない。

// 消しゴムはペンと同じ太さだと細すぎて狙って消せない
export const ERASER_SCALE = 3
export const MIN_ERASER_WIDTH = 8

// マーカーは蛍光ペンなので、ペンより太くないとそれらしく見えない
export const MARKER_SCALE = 3

// 描き終わりから履歴を積むまでの待ち。1 ストロークで複数のイベントが飛ぶので、
// まとめて 1 手にする
export const SNAPSHOT_DEBOUNCE_MS = 150

// 書き出しは WebP を第一候補にする。写真に注釈を入れると PNG では
// 10MB の投稿上限 (src/lib/uploads/limits.ts) に届きうるため
export const WEBP_QUALITY = 0.92

// 白紙の下地。透過のままだと、貼った先の背景次第で線が見えなくなる
export const CANVAS_BACKGROUND = '#ffffff'

// 表示倍率の下限。測り終える前の 0 で割らないための保険
export const MIN_DISPLAY_SCALE = 0.05

// 小さい画像を下敷きにしたとき、原寸のままだと狙って描けない。
// ただし伸ばしすぎてもぼけるだけなので頭を打たせる
export const MAX_DISPLAY_SCALE = 3

// 文字の大きさ。太さから決める (太いペンを選んでいるなら大きい字が要る)
export const FONT_SCALE = 4
export const MIN_FONT_SIZE = 18

// 日本語を出すので、既定の Times New Roman には任せない
export const FONT_FAMILY = 'system-ui, sans-serif'

// 図形をドラッグで置くときの、タップと区別する最小の移動量 (画面で見た px)
export const MIN_SHAPE_DRAG = 4

// 選択枠の見た目 (画面で見た px)。fabric の既定は淡い青 (rgb(178,204,255))・
// 枠 1px・角は塗りなしで、白い紙の上ではほぼ見えない。さらに選択枠は
// canvas の論理 px で描かれて CSS で縮むので、太さ・角の大きさは
// toCanvasUnits で表示倍率ぶん膨らませてから渡す
export const SELECTION_COLOR = '#2563eb' // アプリの主色 (blue-600) に揃える
export const SELECTION_BORDER_PX = 2
// ハンドル (□) は指で狙う目印なので、マウス向けの定番 (10px 前後) より
// 大きく描く。小さいと狙いが甘くなり、当たり判定を広げても外れる
export const SELECTION_CORNER_PX = 20
// タッチの当たり判定は見た目よりさらに大きく取る。指は先端で 10px 以上
// ぶれるので、Apple HIG の最小タップ領域 (44pt) に合わせる。判定だけで、
// 描画は SELECTION_CORNER_PX のまま変わらない
export const SELECTION_TOUCH_CORNER_PX = 44
