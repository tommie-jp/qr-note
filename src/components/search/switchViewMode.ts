import type { ViewMode } from '@/lib/prefs/viewMode'
import {
  beginViewSwitch,
  endViewSwitch,
  pendingViewModeStore,
} from '@/lib/prefs/pendingViewMode'

// 表示モードの釦を押したときの流れ (docs/118 §10 案 B)。switchPaneMode の写し。
//
//   1. 送った先のモードを store に置く → 一覧がその場で描き替わる
//   2. cookie を api/settings/view-mode で書く (サーバアクションにしない理由は
//      その route の注)
//   3. 返事待ちが無くなったら refresh → 足りない材料 (カードの本文プレビュー・
//      数式) をサーバが描いて埋める
//
// 保存は 1 本ずつ順に送る。並べて送ると返事の順が入れ替わり、最後に押した
// モードではなく途中のモードが cookie に残りうる

export const VIEW_MODE_ENDPOINT = '/api/settings/view-mode'

let queue: Promise<void> = Promise.resolve()

async function saveViewMode(mode: ViewMode): Promise<boolean> {
  try {
    const response = await fetch(VIEW_MODE_ENDPOINT, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode }),
    })
    if (!response.ok) {
      console.error(`表示モードを保存できませんでした (HTTP ${response.status})`)
      return false
    }
    return true
  } catch (error) {
    console.error('表示モードを保存できませんでした', error)
    return false
  }
}

export function switchViewMode(next: ViewMode, refresh: () => void): Promise<void> {
  pendingViewModeStore.set(beginViewSwitch(pendingViewModeStore.get(), next))
  queue = queue.then(async () => {
    const ok = await saveViewMode(next)
    const state = endViewSwitch(pendingViewModeStore.get(), ok)
    pendingViewModeStore.set(state)
    // 失敗しても描き直す — 途中の保存が通っていれば cookie はそちらへ進んでいる
    if (state.inflight === 0) {
      refresh()
    }
  })
  return queue
}
