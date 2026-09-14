// スワイプ削除の状態遷移 (docs/43-スワイプ削除計画.md §3)。
//
// 「左へスライドすると削除ボタンが現れる」操作の判定だけをここに閉じ込める。
// DOM も React も触らない純関数にして、テストをこの 1 ファイルに集中させる。
// コンポーネント (SwipeToTrashRow の useSwipeDrawer) は pointer の座標と時刻をそのまま渡すだけ。

// 削除ボタンの幅 (px)。44px (タップ最小) + 「削除」の文字が収まる幅。
export const SWIPE_BUTTON_WIDTH = 72

// 方向を決めるまでのスロップ (px)。これを超えて初めて横/縦を判定する。
// 指の微動でいきなりドラッグ扱いにしないための遊び。
export const SWIPE_SLOP = 8

// ボタン幅を超えて引けるゴム余白 (px)。指に少しだけ付いてくる手応えを出す。
const SWIPE_RUBBER_BAND = 16

// 引ける左端。これ以上は動かさない (ボタン幅 + ゴム余白)。
export const SWIPE_MAX_OFFSET = -(SWIPE_BUTTON_WIDTH + SWIPE_RUBBER_BAND)

// この速さ (px/ms) 以上で払えば、浅くても勢いで開閉する。フリックへの追従。
const SWIPE_OPEN_VELOCITY = 0.3

// idle    … 触れていない/縦スクロールに譲った後。
// tracking… 触れたが横か縦かまだ決まっていない (何も動かさない)。
// dragging… 横と確定し、指に追従して offset を動かしている。
export type SwipePhase = 'idle' | 'tracking' | 'dragging'

export interface SwipeState {
  phase: SwipePhase
  offset: number // 現在の横ずれ (0=閉, 負=左へ開く方向)
  startX: number
  startY: number
  startOffset: number // 触れ始めた時点の offset (開いた状態から掴めるように)
  lastX: number
  lastT: number
  velocity: number // 直近の横速度 (px/ms。負=左向き)
  dragged: boolean // ドラッグに入ったか (直後の click を握りつぶす判定に使う)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

// 開閉状態から初期 state を作る。offset だけ開閉で変える。
export function initialSwipeState(open: boolean): SwipeState {
  const offset = open ? -SWIPE_BUTTON_WIDTH : 0
  return {
    phase: 'idle',
    offset,
    startX: 0,
    startY: 0,
    startOffset: offset,
    lastX: 0,
    lastT: 0,
    velocity: 0,
    dragged: false,
  }
}

// pointerdown。まだ何も動かさず、始点だけ記録して判定を待つ。
export function beginSwipe(
  state: SwipeState,
  x: number,
  y: number,
  t: number,
): SwipeState {
  return {
    ...state,
    phase: 'tracking',
    startX: x,
    startY: y,
    startOffset: state.offset,
    lastX: x,
    lastT: t,
    velocity: 0,
    dragged: false,
  }
}

// pointermove。tracking のうちは横/縦を判定し、dragging では offset を更新する。
export function moveSwipe(
  state: SwipeState,
  x: number,
  y: number,
  t: number,
): SwipeState {
  if (state.phase === 'idle') {
    return state
  }

  const dx = x - state.startX
  const dy = y - state.startY

  if (state.phase === 'tracking') {
    // 縦が先にスロップを超えたら手を引く。以後の move は無視してブラウザの
    // 縦スクロールに全部渡す (横取りしていた分の喧嘩を起こさない)。
    if (Math.abs(dy) > SWIPE_SLOP && Math.abs(dy) >= Math.abs(dx)) {
      return { ...state, phase: 'idle' }
    }
    // 横がスロップを超え、かつ縦に勝ったときだけドラッグ開始。
    if (Math.abs(dx) > SWIPE_SLOP && Math.abs(dx) > Math.abs(dy)) {
      return updateDragging({ ...state, phase: 'dragging', dragged: true }, x, dx, t)
    }
    return state
  }

  // dragging
  return updateDragging(state, x, dx, t)
}

function updateDragging(
  state: SwipeState,
  x: number,
  dx: number,
  t: number,
): SwipeState {
  const offset = clamp(state.startOffset + dx, SWIPE_MAX_OFFSET, 0)
  const dt = t - state.lastT
  // dt=0 の連続イベントで割り算が爆発しないよう、直前速度を保つ。
  const velocity = dt > 0 ? (x - state.lastX) / dt : state.velocity
  return { ...state, offset, velocity, lastX: x, lastT: t }
}

// 離したときに開くか閉じるかを決める。半分を境にしつつ、フリック速度が
// 十分ならそちらを優先する。
export function resolveOpen(state: Pick<SwipeState, 'offset' | 'velocity'>): boolean {
  if (state.velocity <= -SWIPE_OPEN_VELOCITY) {
    return true
  }
  if (state.velocity >= SWIPE_OPEN_VELOCITY) {
    return false
  }
  return state.offset < -SWIPE_BUTTON_WIDTH / 2
}

// スナップ後の state。offset を開閉のどちらかへ揃え、idle に戻す。
export function settleSwipe(open: boolean): SwipeState {
  return initialSwipeState(open)
}
