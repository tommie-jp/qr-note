// 引っ張って更新 (pull-to-refresh) の状態遷移 (docs/47-引っ張って更新計画.md §3)。
//
// 「一覧の先頭で下へ引くと再読み込みが始まる」操作の判定だけをここに閉じ込める。
// DOM も React も触らない純関数にして、テストをこの 1 ファイルに集中させる。
// コンポーネント (PullToRefresh) は touch の座標と「先頭にいるか」を渡すだけ。
//
// なぜ自前か: globals.css で overscroll-behavior:none にして iOS/Android の
// ネイティブな引っ張り更新を止めているため、ジェスチャは自分で判定する。

// これ以上引いて離すと更新する境目 (px)。引き量 (抵抗後) がこれを超えたら発火。
export const PULL_THRESHOLD = 64

// 方向を決めるまでのスロップ (px)。これを超えて初めて縦/横を判定する。
// 指の微動でいきなり引っ張り扱いにしないための遊び (swipeRow と揃える)。
export const PULL_SLOP = 8

// 引ける上限 (px)。指に付いてくる手応えは残しつつ、これ以上は伸ばさない。
export const PULL_MAX = 96

// 抵抗係数。指の移動量にこれを掛けて引き量にする。1 未満で「重い」手応え。
const PULL_RESISTANCE = 0.5

// idle    … 触れていない/縦スクロールや横スワイプに譲った後。
// tracking… 先頭で触れたが、縦下向きかまだ決まっていない (何も動かさない)。
// pulling … 縦下向きと確定し、指に追従して distance を伸ばしている。
export type PullPhase = 'idle' | 'tracking' | 'pulling'

export interface PullState {
  phase: PullPhase
  distance: number // 現在の引き量 (px, 0 以上)。抵抗を掛けた後の見た目の量。
  startX: number
  startY: number
}

// 指の移動量 (下向き正) を、抵抗と上限を掛けた引き量に変換する。
// 上向き (0 以下) は引いていないので 0。
function resist(rawDy: number): number {
  if (rawDy <= 0) {
    return 0
  }
  return Math.min(rawDy * PULL_RESISTANCE, PULL_MAX)
}

export function initialPullState(): PullState {
  return { phase: 'idle', distance: 0, startX: 0, startY: 0 }
}

// touchstart。先頭 (atTop) にいるときだけ始点を記録して判定を待つ。
// 先頭にいなければ、下向きに引いても普通の上スクロールなので手を出さない。
export function beginPull(
  state: PullState,
  x: number,
  y: number,
  atTop: boolean,
): PullState {
  if (!atTop) {
    return { ...state, phase: 'idle', distance: 0 }
  }
  return { ...state, phase: 'tracking', distance: 0, startX: x, startY: y }
}

// touchmove。tracking のうちは縦下向き/それ以外を判定し、
// pulling では distance を更新する。
export function movePull(state: PullState, x: number, y: number): PullState {
  if (state.phase === 'idle') {
    return state
  }

  const dx = x - state.startX
  const dy = y - state.startY // 下向きが正

  if (state.phase === 'tracking') {
    // 横がスロップを超えて縦に勝ったら手を引く。横スワイプ (行削除) や
    // 横向きの操作に全部譲る。
    if (Math.abs(dx) > PULL_SLOP && Math.abs(dx) >= Math.abs(dy)) {
      return { ...state, phase: 'idle', distance: 0 }
    }
    // 上向き (dy<0) が勝ったら手を引く。先頭からの上スクロール開始なので
    // ブラウザに譲る。
    if (-dy > PULL_SLOP && Math.abs(dy) > Math.abs(dx)) {
      return { ...state, phase: 'idle', distance: 0 }
    }
    // 下向きがスロップを超え、かつ縦に勝ったときだけ引っ張り開始。
    if (dy > PULL_SLOP && dy > Math.abs(dx)) {
      return { ...state, phase: 'pulling', distance: resist(dy) }
    }
    return state
  }

  // pulling: 途中で指を戻せば distance は 0 まで縮む (0 未満にはしない)。
  return { ...state, distance: resist(dy) }
}

// 離したときに更新するか決める。しきい値を超えて引けていれば更新。
export function resolveRefresh(state: Pick<PullState, 'phase' | 'distance'>): boolean {
  return state.phase === 'pulling' && state.distance >= PULL_THRESHOLD
}
