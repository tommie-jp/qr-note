// シークレットの鍵束の写し (docs/65-オフライン対応計画.md §9)。ブラウザ専用。
//
// ## なぜ端末に置いてよいのか
//
// 置くのは**サーバが持っているのと同じもの**だけ:
//
//   verifier … 復旧キーの打ち間違いを検出するための検証値
//   wraps    … パスキー由来の KEK で包んだマスターキー
//
// 平文のマスターキーはここに書かない (それはタブのメモリだけ。secretSession.ts)。
// 包みを開けるのは PRF 出力を出せる認証器 (= Face ID) か、紙の復旧キーだけで、
// 端末に写しがあってもその条件は 1 つも緩まない。
//
// ## なぜ写しが要るのか
//
// 解錠の計算 (PRF → KEK → unwrap) は**すべて端末の中**で完結しているのに、
// 手順の入口で鍵束を GET していたせいで、圏外では解錠だけができなかった。
// 写しを持てば、圏外でも断片を復号できる (暗号文は sw.js が持つ)。
//
// **捨てて作り直せるキャッシュ**として扱う。読めなければ「写しが無い」と
// 同じ扱いで、オンラインに戻れば取り直せる。

import type { KeyringState, KeyWrapInfo } from '@/lib/secretApi'
import { deleteRecord, getRecord, putRecord } from './idb'

const KEYRING_KEY = 'state'

export async function saveKeyringCache(state: KeyringState): Promise<void> {
  await putRecord('keyring', KEYRING_KEY, state)
}

export async function clearKeyringCache(): Promise<void> {
  await deleteRecord('keyring', KEYRING_KEY)
}

// 写しを読む。無ければ null、形が違っても null。
//
// **形の検算をここで済ませる**のが要点。この値は unwrapMasterKey へ渡り、
// 壊れていれば「復号できませんでした」になる — 利用者から見ると鍵の間違いと
// 区別が付かない。IndexedDB は他のコードや古い版が書ける場所なので、
// サーバの応答 (secretApi) と同じ厳しさで読み直す。
export async function loadKeyringCache(): Promise<KeyringState | null> {
  const stored = await getRecord('keyring', KEYRING_KEY)
  return stored === undefined ? null : parseKeyringState(stored)
}

function parseKeyringState(value: unknown): KeyringState | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const row = value as Record<string, unknown>
  if (typeof row.initialized !== 'boolean' || !Array.isArray(row.wraps)) {
    return null
  }
  const verifier = parseKeyBytes(row.verifier)
  if (verifier === undefined) {
    return null
  }

  const wraps: KeyWrapInfo[] = []
  for (const entry of row.wraps) {
    const wrap = parseKeyWrap(entry)
    // **1 つでも読めなければ写しごと捨てる。** 落とした 1 つが「いま手元に
    // ある唯一のパスキーの包み」だったとき、黙って落とすと「このパスキーでは
    // 暗号化が有効になっていません」という的外れな案内が出る
    if (wrap === null) {
      return null
    }
    wraps.push(wrap)
  }

  return { initialized: row.initialized, verifier, wraps }
}

function parseKeyWrap(value: unknown): KeyWrapInfo | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const row = value as Record<string, unknown>
  if (typeof row.credentialId !== 'string' || typeof row.label !== 'string') {
    return null
  }
  const wrapped = parseKeyBytes(row.wrapped)
  if (wrapped === undefined) {
    return null
  }
  return { credentialId: row.credentialId, label: row.label, wrapped }
}

// 鍵材料の読み直し。null は「まだ設定していない」という正常な状態なので
// 残し、それ以外の読めない値は undefined (= 呼び出し側が写しごと捨てる) にする。
// 中身が空のバイト列も捨てる — 包みとして成立しない
function parseKeyBytes(value: unknown): Uint8Array | null | undefined {
  if (value === null) {
    return null
  }
  if (value instanceof Uint8Array && value.byteLength > 0) {
    return value
  }
  return undefined
}
