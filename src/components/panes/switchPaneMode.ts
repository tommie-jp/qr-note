import type { PaneMode } from '@/lib/prefs/paneMode'
import {
  beginPaneModeSwitch,
  endPaneModeSwitch,
  pendingPaneModeStore,
} from '@/lib/prefs/pendingPaneMode'

// ペイン構成の釦を押したときの流れ (docs/86 §4-18)。
//
//   1. 送った先の構成を store に置く → 器の積み方がその場で変わる
//   2. cookie を api/settings/pane-mode で書く (サーバアクションにしない理由は
//      その route の注)
//   3. 返事待ちが無くなったら refresh → フォルダーペインと先頭のノートを
//      サーバが描いて埋める
//
// 保存は 1 本ずつ順に送る。並べて送ると返事の順が入れ替わり、最後に押した
// 構成ではなく途中の構成が cookie に残りうる

export const PANE_MODE_ENDPOINT = '/api/settings/pane-mode'

let queue: Promise<void> = Promise.resolve()

async function savePaneMode(mode: PaneMode): Promise<boolean> {
  try {
    const response = await fetch(PANE_MODE_ENDPOINT, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode }),
    })
    if (!response.ok) {
      console.error(`ペイン構成を保存できませんでした (HTTP ${response.status})`)
      return false
    }
    return true
  } catch (error) {
    console.error('ペイン構成を保存できませんでした', error)
    return false
  }
}

export function switchPaneMode(next: PaneMode, refresh: () => void): Promise<void> {
  pendingPaneModeStore.set(beginPaneModeSwitch(pendingPaneModeStore.get(), next))
  queue = queue.then(async () => {
    const ok = await savePaneMode(next)
    const state = endPaneModeSwitch(pendingPaneModeStore.get(), ok)
    pendingPaneModeStore.set(state)
    // 失敗しても描き直す — 途中の保存が通っていれば cookie はそちらへ進んでいる
    if (state.inflight === 0) {
      refresh()
    }
  })
  return queue
}
