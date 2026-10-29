// オフライン同期の差分 (docs/124 §4)。サーバと端末の両方から読む純関数。
//
// 全件の同期は毎回 11MB (圧縮後 2.4MB) を運んでいた。変わるのは普段は数件で、
// 残りは前回の写しと同じ。差分では次の 3 つだけを返す:
//
//   versions … 生きている全ノートの版 [id, 更新時刻, 見た時刻, 印]。並びは
//              全件と同じ (更新の新しい順)。ゴミ箱に入れたノートはここから消える
//   items    … cursor より後に書き換わったノートの本文
//   circuits … 端末に足す回路図 (書き換わったノートの図と、新しく描けた図)。
//              circuitHashes が「持っているべき図」の全部で、端末はそれ以外を捨てる
//
// 端末は前回の写しに重ねて、全件と同じ形の写しを作る (mergeSyncDelta)。
// 辻褄が合わない (版の一覧に写しに無いノートがある・本文が来ないのに版が
// 違う) ときは null を返し、呼ぶ側が全件を取り直す。ゴミ箱から戻したノートは
// 更新時刻が古いままなので、ここに当たって全件になる (稀なので許す)
import {
  parseOfflineCircuit,
  parseOfflineItem,
  type OfflineCircuit,
  type OfflineItem,
  type OfflineSyncPayload,
} from './item'

// 差分に乗せる古さの上限。これより前の写しは全件を取り直す (回路図の取り合わせが
// 長く積み重なって、全件と食い違ったままになるのを防ぐ)
export const SYNC_DELTA_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

// 起点より少し前から「書き換わった」と見なす幅。サーバの時計で揃えているが、
// DB の now() と Node の時刻の小さなずれを吸う。重なりは同じ本文を 2 度運ぶだけ
export const SYNC_DELTA_MARGIN_MS = 10_000

// 同期の口が受け取る起点 (端末が送り返した前回の cursor) を検める。形が違う・
// 未来の時刻・古すぎる起点は null (全件に倒す。断らない — 全件はいつでも正しい)
const CLOCK_SKEW_MS = 60_000
const MAX_SINCE_LENGTH = 40

export function parseSyncSince(raw: string | null, now: number): Date | null {
  if (raw === null || raw.length > MAX_SINCE_LENGTH) {
    return null
  }
  const at = Date.parse(raw)
  if (Number.isNaN(at) || at > now + CLOCK_SKEW_MS || now - at > SYNC_DELTA_MAX_AGE_MS) {
    return null
  }
  return new Date(at)
}

// [itemId, updatedAt, accessedAt, pinned (1 / 0)]。配列にするのは鍵の名前を
// 1514 件ぶん運ばないため
export type ItemVersion = readonly [string, string, string, 0 | 1]

export interface OfflineSyncDelta {
  mode: 'delta'
  syncedAt: string
  cursor: string
  versions: ItemVersion[]
  items: OfflineItem[]
  circuits: OfflineCircuit[]
  circuitHashes: string[]
  truncated: boolean
  circuitsOmitted: number
  etag?: string
}

// 写しから差分に乗れるか。起点があり、古すぎず、回路図がどれも hash を持つ
export function canSyncByDelta(stored: OfflineSyncPayload | null, now: number): boolean {
  if (stored === null || stored.cursor === undefined) {
    return false
  }
  const at = Date.parse(stored.cursor)
  if (Number.isNaN(at) || now - at > SYNC_DELTA_MAX_AGE_MS) {
    return false
  }
  return stored.circuits.every((circuit) => circuit.hash !== undefined)
}

const isString = (v: unknown): v is string => typeof v === 'string' && v !== ''

function parseVersion(value: unknown): ItemVersion | null {
  if (!Array.isArray(value) || value.length !== 4) {
    return null
  }
  const [id, updated, accessed, pinned] = value as unknown[]
  if (!isString(id) || !isString(updated) || !isString(accessed) || (pinned !== 0 && pinned !== 1)) {
    return null
  }
  return [id, updated, accessed, pinned]
}

// 同期の口の data 部が差分なら読む。差分でなければ・壊れていれば null。
// **版の一覧は 1 件も落とさない** — 落とすと、そのノートが写しから消える
export function parseSyncDelta(data: unknown): OfflineSyncDelta | null {
  if (typeof data !== 'object' || data === null) {
    return null
  }
  const d = data as Record<string, unknown>
  if (d.mode !== 'delta' || !isString(d.syncedAt) || !isString(d.cursor)) {
    return null
  }
  if (!Array.isArray(d.versions) || !Array.isArray(d.items) || !Array.isArray(d.circuits) || !Array.isArray(d.circuitHashes)) {
    return null
  }
  const versions = d.versions.map(parseVersion)
  if (versions.some((v) => v === null)) {
    return null
  }
  const items = d.items.map(parseOfflineItem)
  if (items.some((item) => item === null)) {
    return null
  }
  return {
    mode: 'delta',
    syncedAt: d.syncedAt,
    cursor: d.cursor,
    versions: versions as ItemVersion[],
    items: items as OfflineItem[],
    circuits: d.circuits.flatMap((row) => {
      const circuit = parseOfflineCircuit(row)
      return circuit === null || circuit.hash === undefined ? [] : [circuit]
    }),
    circuitHashes: d.circuitHashes.filter(isString),
    truncated: d.truncated === true,
    circuitsOmitted: typeof d.circuitsOmitted === 'number' && Number.isFinite(d.circuitsOmitted) ? d.circuitsOmitted : 0,
    ...(isString(d.etag) ? { etag: d.etag } : {}),
  }
}

// 前回の写しに差分を重ねて、全件と同じ形の写しを作る。辻褄が合わなければ null
export function mergeSyncDelta(
  stored: OfflineSyncPayload,
  delta: OfflineSyncDelta,
): OfflineSyncPayload | null {
  const changed = new Map(delta.items.map((item) => [item.itemId, item]))
  const previous = new Map(stored.items.map((item) => [item.itemId, item]))
  const items: OfflineItem[] = []
  for (const [itemId, updatedAt, accessedAt, pinned] of delta.versions) {
    const base = changed.get(itemId) ?? previous.get(itemId)
    // 写しに無いノート・本文が来ないのに版が違うノート → 全件を取り直す
    if (base === undefined || (!changed.has(itemId) && base.updatedAt !== updatedAt)) {
      return null
    }
    items.push({ ...base, updatedAt, accessedAt, pinned: pinned === 1 })
  }

  const byHash = new Map<string, OfflineCircuit>()
  for (const circuit of [...stored.circuits, ...delta.circuits]) {
    if (circuit.hash !== undefined) {
      byHash.set(circuit.hash, circuit)
    }
  }
  const circuits: OfflineCircuit[] = []
  let missing = 0
  for (const hash of delta.circuitHashes) {
    const circuit = byHash.get(hash)
    if (circuit === undefined) {
      // サーバは持っていると見たが端末に無い (前回は予算で落ちていた図など)。
      // 図はコードブロックとして出るだけなので、全件にせず「運べなかった」に数える
      missing += 1
      continue
    }
    circuits.push(circuit)
  }

  return {
    syncedAt: delta.syncedAt,
    cursor: delta.cursor,
    items,
    truncated: delta.truncated,
    circuits,
    circuitsOmitted: delta.circuitsOmitted + missing,
    ...(delta.etag === undefined ? {} : { etag: delta.etag }),
  }
}
