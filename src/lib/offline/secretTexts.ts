// シークレット内検索の暗号文の控え (docs/130-シークレット内検索計画.md §5-2)。
// ブラウザ専用。
//
// 置くのは**サーバが持っているのと同じ暗号文**と、その sha256 だけ。鍵も
// 復号した文字列も書かない (それはタブのメモリだけ。secret/searchSession.ts)。
// 控えが漏れても、強さはサーバの DB が漏れたのと変わらない。
//
// 役目は通信を減らすこと。トグルを入れるたびに全断片を取り直さず、一覧の
// ハッシュと比べて変わった分だけを取る (secret/search.ts の planSecretSync)。
//
// **捨てて作り直せるキャッシュ**として扱う (offline/idb.ts)。読めない・形が
// 違う行は「控えが無い」と同じで、取り直せば済む。
//
// 全件を 1 つの記録にまとめて持つ。断片ごとに記録を分けないのは、読むのも
// 書くのもトグルを入れたときの 1 回ずつで、まとめたほうが往復が少ないため。

import 'client-only'
import type { CachedSecretText } from '@/lib/secret/search'
import { deleteRecord, getRecord, putRecord } from './idb'

const STORE = 'secretTexts'
const RECORD_KEY = 'all'

// 控えを読む。無ければ空。形が違う行は落とす (取り直しになるだけ)
export async function loadSecretTextCache(): Promise<Map<string, CachedSecretText>> {
  const stored = await getRecord(STORE, RECORD_KEY)
  const cache = new Map<string, CachedSecretText>()
  if (!(stored instanceof Map)) {
    return cache
  }
  for (const [name, value] of stored) {
    const row = parseCached(value)
    if (typeof name === 'string' && row !== null) {
      cache.set(name, row)
    }
  }
  return cache
}

function parseCached(value: unknown): CachedSecretText | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const { hash, data } = value as { hash?: unknown; data?: unknown }
  return typeof hash === 'string' && data instanceof Uint8Array ? { hash, data } : null
}

// 控えを丸ごと差し替える。一覧に無くなった断片はここで消える
// (呼ぶ側が、いま要る分だけを渡す)
export async function saveSecretTextCache(
  cache: ReadonlyMap<string, CachedSecretText>,
): Promise<void> {
  await putRecord(STORE, RECORD_KEY, new Map(cache))
}

export async function clearSecretTextCache(): Promise<void> {
  await deleteRecord(STORE, RECORD_KEY)
}
