// 押した直後の「送った先の表示モード」(docs/118 §10 案 D)。
//
// 表示モードの正本は cookie で、書き換えは Server Action の往復を待つ。本番では
// 押してから一覧が描き直されるまで PC で 108〜193ms・iPhone で 163〜273ms
// かかり、その間は一覧が何も変わらない (§0-11。時間のほぼ全部は回線の往復)。
// 釦は送った先の名前を先に見せる (CycleSlot) が、一覧は古いまま止まって
// 見えるので、送った先がサーバの値と違う間は一覧を「切替中」にする。
//
// 釦 (ResultsToolbar) と一覧の器 (ViewSwitchVeil) は親子でないので React の外に
// 置く (pendingPaneMode と同じ作り)。
//
// token … 押下ごとの番号。返事が来ない (Action が失敗した) ときに切替中のまま
// 固まらないよう上限で捨てるが、そのあいだに押し直していれば捨てない
import { useEffect } from 'react'
import { createExternalStore } from '@/lib/prefs/externalStore'

export interface PendingViewSwitch {
  readonly mode: string | null
  readonly token: number
}

export const IDLE_VIEW_SWITCH: PendingViewSwitch = { mode: null, token: 0 }

// 返事を待つ上限。往復は本番で 300ms 以内なので、これを過ぎたら失敗とみなす
export const VIEW_SWITCH_TIMEOUT_MS = 10_000

// 押した。送った先を見せる
export function beginViewSwitch(
  _state: PendingViewSwitch,
  mode: string,
  token: number,
): PendingViewSwitch {
  return { mode, token }
}

// サーバの描き直しが送った先に追いついたら片付ける。続けて押したときの
// 途中の描き直し (1 回目の結果) では、送った先 (2 回目) と違うので残す
export function settleViewSwitch(
  state: PendingViewSwitch,
  serverMode: string,
): PendingViewSwitch {
  return state.mode === serverMode ? IDLE_VIEW_SWITCH : state
}

// 上限を過ぎた。その押下のあとに押し直していなければ捨てる
export function expireViewSwitch(
  state: PendingViewSwitch,
  token: number,
): PendingViewSwitch {
  return state.token === token ? IDLE_VIEW_SWITCH : state
}

export function isSwitchingView(state: PendingViewSwitch, serverMode: string): boolean {
  return state.mode !== null && state.mode !== serverMode
}

export const pendingViewModeStore = createExternalStore<PendingViewSwitch>({
  initial: () => IDLE_VIEW_SWITCH,
  serverSnapshot: IDLE_VIEW_SWITCH,
})

let lastToken = 0

// 釦が押された (フォームの submit)。送った先を置き、上限で捨てる時計を仕掛ける
export function markViewSwitch(mode: string): void {
  lastToken += 1
  const token = lastToken
  pendingViewModeStore.set(beginViewSwitch(pendingViewModeStore.get(), mode, token))
  setTimeout(() => {
    const next = expireViewSwitch(pendingViewModeStore.get(), token)
    if (next !== pendingViewModeStore.get()) {
      pendingViewModeStore.set(next)
    }
  }, VIEW_SWITCH_TIMEOUT_MS)
}

// いま切替中か。サーバの描き直しが追いついたら送った先を片付ける
export function useSwitchingView(serverMode: string): boolean {
  const pending = pendingViewModeStore.useStore()
  useEffect(() => {
    const settled = settleViewSwitch(pendingViewModeStore.get(), serverMode)
    if (settled !== pendingViewModeStore.get()) {
      pendingViewModeStore.set(settled)
    }
  }, [pending, serverMode])
  return isSwitchingView(pending, serverMode)
}
