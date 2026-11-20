// シークレット内検索の材料をブラウザから取る手順
// (docs/130-シークレット内検索計画.md §5-1)。
//
// **検索語は送らない**。取るのは全件の一覧と、名前で指した暗号文だけ。
// サーバの応答は外部入力として検算する (secret/api.ts と同じ流儀)。

import { fetchEnvelope } from '../api/envelope'
import { isItemDto, reviveItem } from '../api/itemDto'
import type { Item } from '@/generated/prisma/client'
import { base64ToBytes } from '../bytesBase64'
import type { SecretTextEntry, SecretTextRef } from './search'
import { isValidSecretName } from './secrets'

// /api/secrets/ の下ではない (Service Worker が棚を先に見るため。
// app/api/secret-texts/route.ts に経緯)
const SECRET_TEXTS_PATH = '/api/secret-texts'

const BROKEN_MESSAGE = 'シークレットの一覧を読み取れませんでした'

// 端末が受け取る材料。断片の一覧と、シークレットを含むノート (docs/131 §4-1)
export interface SecretSearchMaterial {
  entries: SecretTextEntry[]
  items: Item[]
}

export async function fetchSecretTextIndex(): Promise<SecretSearchMaterial> {
  const data = await fetchEnvelope<{ entries?: unknown; items?: unknown }>(SECRET_TEXTS_PATH, {
    method: 'GET',
  })
  const { entries, items } = data ?? {}
  if (!Array.isArray(entries) || !Array.isArray(items) || !items.every(isItemDto)) {
    throw new Error(BROKEN_MESSAGE)
  }
  return { entries: entries.map(parseEntry), items: items.map(reviveItem) }
}

function parseEntry(value: unknown): SecretTextEntry {
  const row = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const { name, hash, bytes, refs } = row
  if (
    typeof name !== 'string' ||
    !isValidSecretName(name) ||
    typeof hash !== 'string' ||
    typeof bytes !== 'number' ||
    !Number.isFinite(bytes) ||
    bytes < 0 ||
    !Array.isArray(refs)
  ) {
    throw new Error(BROKEN_MESSAGE)
  }
  return { name, hash, bytes, refs: refs.map(parseRef) }
}

function parseRef(value: unknown): SecretTextRef {
  const row = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const { itemId, title, label } = row
  if (typeof itemId !== 'string' || typeof title !== 'string' || typeof label !== 'string') {
    throw new Error(BROKEN_MESSAGE)
  }
  return { itemId, title, label }
}

// 名前で指した暗号文を取る。**頼んでいない名前・読めない行は捨てる**
// (無い名前はサーバが黙って飛ばすので、返ってこないこと自体は正常)。
export async function fetchSecretTextBlobs(
  names: readonly string[],
): Promise<Map<string, Uint8Array>> {
  const data = await fetchEnvelope<{ blobs?: unknown }>(SECRET_TEXTS_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ names }),
  })
  if (!Array.isArray(data?.blobs)) {
    throw new Error(BROKEN_MESSAGE)
  }
  const asked = new Set(names)
  const blobs = new Map<string, Uint8Array>()
  for (const value of data.blobs) {
    const { name, data: encoded } = (value ?? {}) as { name?: unknown; data?: unknown }
    const bytes = typeof encoded === 'string' ? base64ToBytes(encoded) : null
    if (typeof name === 'string' && asked.has(name) && bytes !== null) {
      blobs.set(name, bytes)
    }
  }
  return blobs
}
