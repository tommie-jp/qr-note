// シークレット内検索の照合と、取りに行く断片の決め方
// (docs/130-シークレット内検索計画.md §4, §5)。
//
// **ここは純関数だけ**。鍵・通信・IndexedDB に触らないので、サーバ (一覧を
// 組む側) とブラウザ (照合する側) の両方から読める。
//
// 照合は「1 つの断片の中に、検索語の素の語がすべてある」(§4)。正規化は
// オフライン検索 (offline/filter.ts) と同じ normalizeTag (NFKC + 小文字化) で、
// PGroonga の NormalizerAuto に揃えたもの。

import { normalizeTag } from '../markdown/tags/tags'
import { parseSearchExpr } from '../search/parse'
import type { SearchExpr } from '../search/types'

// 断片を参照しているノート 1 件ぶん
export interface SecretTextRef {
  itemId: string
  // ノートの題名 (items.title)。空のこともある
  title: string
  // 本文に書かれたラベル (平文)
  label: string
}

// サーバが返す一覧の 1 行。**検索語には依らない** — 全件が同じ形で返る
export interface SecretTextEntry {
  name: string
  // 暗号文の sha256 (hex)。封をし直すと IV が変わるので、編集の検知に使える
  hash: string
  // 暗号文の大きさ
  bytes: number
  refs: SecretTextRef[]
}

// 検索語から、断片の照合に使う素の語を取り出す (正規化済み・重複なし)。
//
// タグ・is:todo などの演算子は断片に対して意味を持たないので捨てる。
// **NOT の下の語も捨てる** — 「!foo」は「foo を含まない」で、断片を探す語では
// ない。OR は区別せず全部を AND で見る (v1 の割り切り。docs/130 §4)。
export function secretQueryTerms(query: string): string[] {
  const expr = parseSearchExpr(query)
  if (expr === null) {
    return []
  }
  const terms = new Set<string>()
  collectTextTerms(expr, terms)
  return [...terms]
}

function collectTextTerms(expr: SearchExpr, into: Set<string>): void {
  switch (expr.op) {
    case 'term': {
      if (expr.term.kind === 'text') {
        const value = normalizeTag(expr.term.value)
        if (value !== '') {
          into.add(value)
        }
      }
      return
    }
    case 'not':
      return
    case 'and':
    case 'or':
      for (const child of expr.children) {
        collectTextTerms(child, into)
      }
  }
}

// 復号済みの断片を照合に使う形へ畳む (読み込み時に 1 度だけ)
export function normalizeSecretText(text: string): string {
  return normalizeTag(text)
}

// 語がすべて入っている断片の名前を、渡された順のまま返す。
// 語が 1 つも無ければ何も当てない (空の検索で全断片を並べない)。
export function matchSecretTexts(
  haystacks: ReadonlyMap<string, string>,
  terms: readonly string[],
): string[] {
  if (terms.length === 0) {
    return []
  }
  const hits: string[] = []
  for (const [name, haystack] of haystacks) {
    if (terms.every((term) => haystack.includes(term))) {
      hits.push(name)
    }
  }
  return hits
}

// 一致した断片を、画面に出す行 (ノート × ラベル) へ開く。
// 同じノートの別の断片は別の行になる (ラベルで見分ける)。
export interface SecretSearchHit extends SecretTextRef {
  name: string
}

export function secretSearchHits(
  entries: readonly SecretTextEntry[],
  names: readonly string[],
): SecretSearchHit[] {
  const matched = new Set(names)
  return entries.flatMap((entry) =>
    matched.has(entry.name) ? entry.refs.map((ref) => ({ ...ref, name: entry.name })) : [],
  )
}

// --- 一致を通常の一覧の行として出す (docs/131) ---

// 一致した断片から「ノート → 当たった断片のラベル」を作る。
// 並びは一覧 (entries) の順、同じノートの同じラベルは 1 つに畳む。
export function secretRowLabels(
  entries: readonly SecretTextEntry[],
  names: readonly string[],
): Map<string, string[]> {
  const labels = new Map<string, string[]>()
  for (const hit of secretSearchHits(entries, names)) {
    const known = labels.get(hit.itemId)
    if (known === undefined) {
      labels.set(hit.itemId, [hit.label])
    } else if (!known.includes(hit.label)) {
      known.push(hit.label)
    }
  }
  return labels
}

// シークレット内の一致を先頭に、通常の一致をその後ろに並べる。
// 同じノートが両方にあれば先頭の 1 回だけ (下からは外す)。**どちらの配列も
// 書き換えない** — 通常の側は一覧の控えの値そのもの
export function mergeSecretRows<T extends { itemId: string }>(
  secretItems: readonly T[],
  normalItems: readonly T[],
): T[] {
  if (secretItems.length === 0) {
    return [...normalItems]
  }
  const pinned = new Set(secretItems.map((item) => item.itemId))
  return [...secretItems, ...normalItems.filter((item) => !pinned.has(item.itemId))]
}

// --- 取りに行く断片の決め方 (docs/130 §5-2, §7) ---

// 端末に控えた暗号文 1 件
export interface CachedSecretText {
  hash: string
  data: Uint8Array
}

// 照合の対象にする暗号文の合計の上限。超えた断片は対象外にして件数を知らせる
export const SECRET_SEARCH_MAX_BYTES = 20 * 1024 * 1024

export interface SecretSyncPlan {
  // 控えをそのまま使える断片
  keep: string[]
  // サーバから取る断片 (控えに無い・ハッシュが変わった)
  fetch: string[]
  // 上限を超えたので対象外にした数
  skipped: number
}

// 一覧と控えを比べ、どれを使い回し、どれを取りに行くかを決める。
// 一覧に無い控えは keep にも fetch にも入らない = 呼ぶ側が捨てる。
export function planSecretSync(
  entries: readonly SecretTextEntry[],
  cached: ReadonlyMap<string, CachedSecretText>,
  maxBytes = SECRET_SEARCH_MAX_BYTES,
): SecretSyncPlan {
  const plan: SecretSyncPlan = { keep: [], fetch: [], skipped: 0 }
  let total = 0
  for (const entry of entries) {
    if (total + entry.bytes > maxBytes) {
      plan.skipped += 1
      continue
    }
    total += entry.bytes
    if (cached.get(entry.name)?.hash === entry.hash) {
      plan.keep.push(entry.name)
    } else {
      plan.fetch.push(entry.name)
    }
  }
  return plan
}

// まとめ取り 1 回ぶんの上限 (サーバの口がこの数字で断る)
export const SECRET_BATCH_MAX_NAMES = 100
export const SECRET_BATCH_MAX_BYTES = 4 * 1024 * 1024
// 端末が束に詰める目安。**サーバの上限より小さくしておく** — 端末は一覧の
// 大きさで詰め、サーバはその時点の実際の大きさで断るので、一覧を取った後に
// 断片が編集で太ると、ぎりぎりまで詰めた束は 413 になる
export const SECRET_BATCH_TARGET_BYTES = 3 * 1024 * 1024

// 取りに行く名前を、1 回の上限に収まる束へ分ける。
// 1 件で上限を超える断片は単独の束にする (サーバは 1 件だけなら通す)。
export function chunkSecretFetch(
  names: readonly string[],
  bytesOf: (name: string) => number,
): string[][] {
  const chunks: string[][] = []
  let current: string[] = []
  let currentBytes = 0
  for (const name of names) {
    const bytes = bytesOf(name)
    const isFull =
      current.length >= SECRET_BATCH_MAX_NAMES ||
      (current.length > 0 && currentBytes + bytes > SECRET_BATCH_TARGET_BYTES)
    if (isFull) {
      chunks.push(current)
      current = []
      currentBytes = 0
    }
    current.push(name)
    currentBytes += bytes
  }
  if (current.length > 0) {
    chunks.push(current)
  }
  return chunks
}
