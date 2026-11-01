// 解錠中のマスターキーを持つ場所 (docs/51-部分暗号化計画.md §6)。
//
// **タブのメモリだけ**。localStorage にも Cookie にも書かない — 書けば
// 「端末を開けば読める」ことになり、パスキーで守っている意味が薄れる。
// 再読込したら Face ID で解錠し直す。
//
// 生バイト列も併せて持つ: 2 台目のパスキーへ包み直すときと、復旧キーを
// 表示するときに要る (CryptoKey は非 extractable で取り出せない)。
// 持ち続ける時間は下の自動施錠で縛る。

import { useSyncExternalStore } from 'react'
import { createExternalStore } from '../prefs/externalStore'
import { importContentKey } from './envelope'

interface UnlockedSecrets {
  readonly masterKey: CryptoKey
  readonly masterKeyBytes: Uint8Array
}

// 未解錠なら null。鍵と生バイト列は必ず対で入れ替える (prefs/externalStore.ts)
const session = createExternalStore<UnlockedSecrets | null>({
  initial: () => null,
  serverSnapshot: null,
})

// 自動施錠 (2026-11 のセキュリティ監査 M-7)。以前は手で「施錠」を押すまで鍵が
// タブに残り続けた。XSS が 1 つあれば解錠中の鍵まで届くので、使っていない間は
// 持たない:
//   - 最後に鍵を使ってから SECRET_IDLE_LOCK_MS 操作が無ければ施錠
//   - タブが隠れて SECRET_HIDDEN_LOCK_MS 経ったら施錠 (戻ってきたら Face ID)
//   - 頁を離れる (pagehide) ときも施錠
// タイマーは解錠中だけ動かす。「鍵を使った」= unlockedKey / unlockedMasterKeyBytes
// を読んだとき (復号・暗号化・包み直しはどれもここを通る)
export const SECRET_IDLE_LOCK_MS = 5 * 60 * 1000
export const SECRET_HIDDEN_LOCK_MS = 60 * 1000

let idleTimer: ReturnType<typeof setTimeout> | null = null
let hiddenTimer: ReturnType<typeof setTimeout> | null = null
let listening = false

function clearTimers(): void {
  if (idleTimer !== null) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  if (hiddenTimer !== null) {
    clearTimeout(hiddenTimer)
    hiddenTimer = null
  }
}

// 鍵を使った印。解錠中なら無操作の数え直し
function touch(): void {
  if (session.get() === null) {
    return
  }
  if (idleTimer !== null) {
    clearTimeout(idleTimer)
  }
  idleTimer = setTimeout(lockSecrets, SECRET_IDLE_LOCK_MS)
}

function onVisibilityChange(): void {
  if (session.get() === null) {
    return
  }
  if (document.visibilityState === 'hidden') {
    hiddenTimer ??= setTimeout(lockSecrets, SECRET_HIDDEN_LOCK_MS)
    return
  }
  if (hiddenTimer !== null) {
    clearTimeout(hiddenTimer)
    hiddenTimer = null
  }
}

// 頁の事件を一度だけ聞く (解錠のたびに足さない)。サーバ描画・テストで
// document が無ければ無操作のタイマーだけが効く
function listenOnce(): void {
  if (listening || typeof document === 'undefined') {
    return
  }
  listening = true
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', lockSecrets)
}

export async function unlockWith(raw: Uint8Array): Promise<void> {
  const masterKey = await importContentKey(raw)
  session.set({ masterKey, masterKeyBytes: Uint8Array.from(raw) })
  listenOnce()
  touch()
  // 解錠した時点で既に隠れていることもある (別タブで Face ID を済ませた直後など)
  if (typeof document !== 'undefined') {
    onVisibilityChange()
  }
}

export function lockSecrets(): void {
  clearTimers()
  session.set(null)
}

// 断片の暗号化・復号に使う鍵。未解錠なら null。
export function unlockedKey(): CryptoKey | null {
  touch()
  return session.get()?.masterKey ?? null
}

// 包み直し・復旧キー表示に使う生バイト列。未解錠なら null。
export function unlockedMasterKeyBytes(): Uint8Array | null {
  touch()
  const unlocked = session.get()
  return unlocked === null ? null : Uint8Array.from(unlocked.masterKeyBytes)
}

export function isUnlocked(): boolean {
  return session.get() !== null
}

// 解錠・施錠のたびに呼ばれる購読口。
//
// useSecretUnlocked は「いま解錠しているか」を描画に使うためのもので、
// こちらは「施錠されたので手元の復号済みデータを捨てる」といった後始末に使う
// (React の外の資源 = Blob URL の解放など)。
export function subscribeSecretLock(listener: () => void): () => void {
  return session.subscribe(listener)
}

// 解錠状態を購読する。サーバ描画では常に false (鍵はブラウザにしかない)。
//
// スナップショットは真偽値に畳む (session.useStore を使わない)。鍵の組を
// そのまま返すと、解錠し直すたびに参照が変わって描画が余計に走る
export function useSecretUnlocked(): boolean {
  return useSyncExternalStore(subscribeSecretLock, isUnlocked, () => false)
}
