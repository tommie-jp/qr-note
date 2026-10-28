import { useEffect } from 'react'
import { createExternalStore } from '@/lib/prefs/externalStore'
import type { PaneMode } from '@/lib/prefs/paneMode'

// 押した直後の「送った先のペイン構成」(docs/86 §4-18)。
//
// 構成の正本は cookie で、サーバが描画前に読む。ただ cookie の書き換えと
// 描き直しの往復を待つと、押してから画面が組み替わるまで 3 秒かかった
// (通信 1.5 秒の遅延を入れた計測)。器の積み方は CSS の [data-panes] と
// PreviewPane が決めるだけでサーバは要らないので、送った先の構成を先に
// ここへ置き、検索画面 (PaneModeProvider) と釦 (ヘッダー) が同じ値を読む。
//
// ヘッダーは root layout、検索画面は (search)/layout の中で、共通の
// context の親が居ない。だから React の外に置く。
//
// inflight … まだ返事の来ていない保存の数。続けて押したとき、途中の
// 描き直し (1 回目の保存の結果) で画面が 1 つ前の構成へ戻らないよう、
// 全部返ってくるまでは送った先を持ち続ける

export interface PendingPaneMode {
  readonly mode: PaneMode | null
  readonly inflight: number
}

export const IDLE_PANE_MODE: PendingPaneMode = { mode: null, inflight: 0 }

// 押した。送った先を見せ、返事待ちを 1 つ増やす
export function beginPaneModeSwitch(state: PendingPaneMode, next: PaneMode): PendingPaneMode {
  return { mode: next, inflight: state.inflight + 1 }
}

// 保存の返事が来た。**失敗して待ちが無くなったら送った先を捨てる** —
// cookie は元のままなので、サーバの値 (元の構成) へ戻すのが正しい
export function endPaneModeSwitch(state: PendingPaneMode, ok: boolean): PendingPaneMode {
  const inflight = Math.max(0, state.inflight - 1)
  return { mode: !ok && inflight === 0 ? null : state.mode, inflight }
}

// サーバの描き直しが送った先に追いついたら、もう持っている理由がない。
// 待ちが残っている間は捨てない (次の描き直しで更に先へ進むため)
export function settlePendingPaneMode(state: PendingPaneMode, serverMode: PaneMode): PendingPaneMode {
  return state.inflight === 0 && state.mode === serverMode ? IDLE_PANE_MODE : state
}

export const pendingPaneModeStore = createExternalStore<PendingPaneMode>({
  initial: () => IDLE_PANE_MODE,
  serverSnapshot: IDLE_PANE_MODE,
})

// サーバの構成 (cookie) に送った先を重ねた、いま見せる構成。
// 追いついたら送った先を片付ける
export function useShownPaneMode(serverMode: PaneMode): PaneMode {
  const pending = pendingPaneModeStore.useStore()
  useEffect(() => {
    const settled = settlePendingPaneMode(pendingPaneModeStore.get(), serverMode)
    if (settled !== pendingPaneModeStore.get()) {
      pendingPaneModeStore.set(settled)
    }
  }, [pending, serverMode])
  return pending.mode ?? serverMode
}
