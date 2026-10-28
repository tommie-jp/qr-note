// 押した直後の「送った先の表示モード」(docs/118 §10 案 B)。
//
// 表示モードの正本は cookie で、サーバが描画前に読む。ただ cookie の書き換えと
// 描き直しの往復を待つと、押してから一覧が変わるまで本番で 150〜270ms かかり、
// その時間のほぼ全部が回線の往復だった (§0-11)。一覧 (ItemList) は 4 つの
// モードの描き方を既に持っているので、送った先のモードをここへ置き、一覧と釦が
// 同じ値を読んで**押した瞬間に描き替える**。足りない材料 (カードの本文
// プレビュー・数式) は、保存の後の router.refresh() で埋まる。
//
// 釦 (ResultsToolbar) と一覧 (ItemList) は親子でないので React の外に置く
// (pendingPaneMode と同じ作り)。
//
// inflight … まだ返事の来ていない保存の数。続けて押したとき、途中の描き直し
// (1 回目の保存の結果) で一覧が 1 つ前のモードへ戻らないよう、全部返って
// くるまでは送った先を持ち続ける
import { useEffect } from 'react'
import { createExternalStore } from '@/lib/prefs/externalStore'
import type { ViewMode } from '@/lib/prefs/viewMode'

export interface PendingViewSwitch {
  readonly mode: ViewMode | null
  readonly inflight: number
}

export const IDLE_VIEW_SWITCH: PendingViewSwitch = { mode: null, inflight: 0 }

// 押した。送った先を見せ、返事待ちを 1 つ増やす
export function beginViewSwitch(state: PendingViewSwitch, next: ViewMode): PendingViewSwitch {
  return { mode: next, inflight: state.inflight + 1 }
}

// 保存の返事が来た。**失敗して待ちが無くなったら送った先を捨てる** —
// cookie は元のままなので、サーバの値 (元のモード) へ戻すのが正しい
export function endViewSwitch(state: PendingViewSwitch, ok: boolean): PendingViewSwitch {
  const inflight = Math.max(0, state.inflight - 1)
  return { mode: !ok && inflight === 0 ? null : state.mode, inflight }
}

// サーバの描き直しが送った先に追いついたら、もう持っている理由がない。
// 待ちが残っている間は捨てない (次の描き直しで更に先へ進むため)
export function settleViewSwitch(state: PendingViewSwitch, serverMode: ViewMode): PendingViewSwitch {
  return state.inflight === 0 && state.mode === serverMode ? IDLE_VIEW_SWITCH : state
}

export function shownViewMode(state: PendingViewSwitch, serverMode: ViewMode): ViewMode {
  return state.mode ?? serverMode
}

export const pendingViewModeStore = createExternalStore<PendingViewSwitch>({
  initial: () => IDLE_VIEW_SWITCH,
  serverSnapshot: IDLE_VIEW_SWITCH,
})

// サーバの表示モード (cookie) に送った先を重ねた、いま見せるモード。
// 追いついたら送った先を片付ける
export function useShownViewMode(serverMode: ViewMode): ViewMode {
  const pending = pendingViewModeStore.useStore()
  useEffect(() => {
    const settled = settleViewSwitch(pendingViewModeStore.get(), serverMode)
    if (settled !== pendingViewModeStore.get()) {
      pendingViewModeStore.set(settled)
    }
  }, [pending, serverMode])
  return shownViewMode(pending, serverMode)
}
