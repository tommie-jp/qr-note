// 解錠中のマスターキーを持つ場所 (docs/51-部分暗号化計画.md §6)。
//
// **タブのメモリだけ**。localStorage にも Cookie にも書かない — 書けば
// 「端末を開けば読める」ことになり、パスキーで守っている意味が薄れる。
// 再読込したら Face ID で解錠し直す。
//
// 生バイト列も併せて持つ: 2 台目のパスキーへ包み直すときと、復旧キーを
// 表示するときに要る (CryptoKey は非 extractable で取り出せない)。

import { useSyncExternalStore } from 'react'
import { createExternalStore } from './prefs/externalStore'
import { importContentKey } from './secretEnvelope'

interface UnlockedSecrets {
  readonly masterKey: CryptoKey
  readonly masterKeyBytes: Uint8Array
}

// 未解錠なら null。鍵と生バイト列は必ず対で入れ替える (prefs/externalStore.ts)
const session = createExternalStore<UnlockedSecrets | null>({
  initial: () => null,
  serverSnapshot: null,
})

export async function unlockWith(raw: Uint8Array): Promise<void> {
  const masterKey = await importContentKey(raw)
  session.set({ masterKey, masterKeyBytes: Uint8Array.from(raw) })
}

export function lockSecrets(): void {
  session.set(null)
}

// 断片の暗号化・復号に使う鍵。未解錠なら null。
export function unlockedKey(): CryptoKey | null {
  return session.get()?.masterKey ?? null
}

// 包み直し・復旧キー表示に使う生バイト列。未解錠なら null。
export function unlockedMasterKeyBytes(): Uint8Array | null {
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
