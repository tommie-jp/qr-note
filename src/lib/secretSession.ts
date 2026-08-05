// 解錠中のマスターキーを持つ場所 (docs/51-部分暗号化計画.md §6)。
//
// **タブのメモリだけ**。localStorage にも Cookie にも書かない — 書けば
// 「端末を開けば読める」ことになり、パスキーで守っている意味が薄れる。
// 再読込したら Face ID で解錠し直す。
//
// 生バイト列も併せて持つ: 2 台目のパスキーへ包み直すときと、復旧キーを
// 表示するときに要る (CryptoKey は非 extractable で取り出せない)。

import { useSyncExternalStore } from 'react'
import { importContentKey } from './secretEnvelope'

let masterKeyBytes: Uint8Array | null = null
let masterKey: CryptoKey | null = null

const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

export async function unlockWith(raw: Uint8Array): Promise<void> {
  masterKey = await importContentKey(raw)
  masterKeyBytes = Uint8Array.from(raw)
  notify()
}

export function lockSecrets(): void {
  masterKey = null
  masterKeyBytes = null
  notify()
}

// 断片の暗号化・復号に使う鍵。未解錠なら null。
export function unlockedKey(): CryptoKey | null {
  return masterKey
}

// 包み直し・復旧キー表示に使う生バイト列。未解錠なら null。
export function unlockedMasterKeyBytes(): Uint8Array | null {
  return masterKeyBytes === null ? null : Uint8Array.from(masterKeyBytes)
}

export function isUnlocked(): boolean {
  return masterKey !== null
}

// 解錠・施錠のたびに呼ばれる購読口。
//
// useSecretUnlocked は「いま解錠しているか」を描画に使うためのもので、
// こちらは「施錠されたので手元の復号済みデータを捨てる」といった後始末に使う
// (React の外の資源 = Blob URL の解放など)。
export function subscribeSecretLock(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// 解錠状態を購読する。サーバ描画では常に false (鍵はブラウザにしかない)。
export function useSecretUnlocked(): boolean {
  return useSyncExternalStore(subscribeSecretLock, isUnlocked, () => false)
}
