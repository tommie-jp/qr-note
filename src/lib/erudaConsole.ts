// eruda (モバイル向けの DevTools 相当) の出し入れ (docs/30-ブラウザログ計画.md §2)。
//
// console だけでなく **network** (fetch の失敗・ステータス) と storage まで
// 見える。iPhone は Mac 無しでインスペクタを繋げないので、その場で深掘りする
// 手段がこれしかない。転送 (docs/30 §1) は warn/error しか運ばないぶん、
// ここが埋める範囲は広い。
//
// **本体は ?debug のときだけ動的 import する**。常時ロードすると 100KB 超が
// 全ページに乗る。普段のバンドルには入らない。
//
// ログイン前でも動く (クライアントで完結し、サーバに何も置かない)。
// 転送の側は 401 になって運べないので、ログインできない不具合はここで見る。

import 'client-only'
import { DEBUG_STORAGE_KEY } from './debugConsole'

// 読み込み済みの本体。destroy 後に再び出せるよう、都度 import せず持っておく
let loaded: { destroy: () => void } | null = null

// 出ているかを見ている React 側 (DebugConsoleButton) への通知。
// sessionStorage は変更を知らせてくれない (storage イベントは別タブの分だけ)
const listeners = new Set<() => void>()

// sessionStorage は Safari のプライベートモードなどで投げうる。
// 覚えられないだけで機能自体は動く (その場では出る) ので、既定に倒す
function remember(enabled: boolean): void {
  try {
    if (enabled) {
      sessionStorage.setItem(DEBUG_STORAGE_KEY, '1')
    } else {
      sessionStorage.removeItem(DEBUG_STORAGE_KEY)
    }
  } catch {
    // 覚えられないだけ。再読み込みで消えるが、出し入れ自体は成立する
  }
  for (const listener of listeners) {
    listener()
  }
}

export function isDebugConsoleOn(): boolean {
  try {
    return sessionStorage.getItem(DEBUG_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function subscribeDebugConsole(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// **覚えるのは成否が決まってから**。先に覚えると、本体の読み込みに失敗した
// ときに「出ていることになっているが出ていない」状態が残る
export async function setDebugConsole(enabled: boolean): Promise<void> {
  if (!enabled) {
    loaded?.destroy()
    loaded = null
    remember(false)
    return
  }

  if (!loaded) {
    const eruda = (await import('eruda')).default
    eruda.init()
    loaded = eruda
  }
  remember(true)
}
