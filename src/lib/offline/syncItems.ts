// 同期 API がノートを引くところ (docs/65-オフライン対応計画.md §3-1)。
//
// **サーバ専用**。prisma を読むので、クライアントから import してはいけない
// (共有したい型と定数は item.ts が持つ。images/thumbnail.ts が定数のつもりの import で
// sharp をクライアントへ漏らした件と同じ落とし穴)。
//
// 差分の同期もする (docs/124 §4)。始めた頃は全ノートで数百 KB だった
// (docs/65 §3-2) が、1514 件で 11MB (圧縮後 2.4MB) になった。差分は
// loadOfflineSyncDelta で、「消えたノートを端末からも消す」は版の一覧
// (versions) に無いことで伝える。端末は写しを全件と同じ形に組み直す
// (syncDelta.ts の mergeSyncDelta)。

import 'server-only'
import { prisma } from '@/lib/db'
import {
  CIRCUITIKZ_LANG,
  type CircuitFence,
  circuitKey,
} from '@/lib/circuit/fences'
import { circuitYamlHash } from '@/lib/circuit/yaml'
import { circuitHash } from '@/lib/circuit/hash'
import {
  OFFLINE_CIRCUIT_BUDGET,
  OFFLINE_SYNC_LIMIT,
  type OfflineCircuit,
  type OfflineItem,
  type OfflineSyncPayload,
} from './item'
import { SYNC_DELTA_MARGIN_MS, type OfflineSyncDelta } from './syncDelta'
import { circuitFencesOfMany } from '@/lib/circuit/fenceStore'

// ゴミ箱のノートは運ばない。オフラインではゴミ箱も復元も出さないので、
// 端末に置いても検索を濁らせるだけになる。
//
// 上限に届いたときのために更新の新しい順で引く。打ち切るなら、最近書いた
// ものが残るほうが現場で役に立つ (docs/65 の想定は「棚の前で引く」)。
// 生きているノートを更新の新しい順に引く。全件と差分で同じ並び・同じ上限
async function loadOfflineItems(): Promise<{ items: OfflineItem[]; truncated: boolean }> {
  const rows = await prisma.item.findMany({
    where: { deletedAt: null },
    select: {
      itemId: true,
      memo: true,
      title: true,
      tags: true,
      taskTodo: true,
      taskDone: true,
      updatedAt: true,
      accessedAt: true,
      offlinePin: true,
    },
    orderBy: [{ updatedAt: 'desc' }, { itemId: 'asc' }],
    take: OFFLINE_SYNC_LIMIT + 1,
  })
  const truncated = rows.length > OFFLINE_SYNC_LIMIT
  const items: OfflineItem[] = rows.slice(0, OFFLINE_SYNC_LIMIT).map(({ offlinePin, ...row }) => ({
    ...row,
    updatedAt: row.updatedAt.toISOString(),
    accessedAt: row.accessedAt.toISOString(),
    pinned: offlinePin,
  }))
  return { items, truncated }
}

export async function loadOfflineSyncPayload(): Promise<OfflineSyncPayload> {
  // 起点は**読み始める前**に取る (item.ts の cursor の理由)
  const cursor = new Date().toISOString()
  const { items, truncated } = await loadOfflineItems()
  const { circuits, circuitsOmitted } = await loadOfflineCircuits(items)
  return {
    syncedAt: new Date().toISOString(),
    cursor,
    items,
    truncated,
    circuits: circuits.map(({ createdAt: _createdAt, ...circuit }) => circuit),
    circuitsOmitted,
  }
}

// 差分の同期 (docs/124 §4)。since は端末が送り返した前回の cursor。
// 本文と回路図の SVG は「since より後に変わった物」だけを載せる
export async function loadOfflineSyncDelta(since: Date): Promise<OfflineSyncDelta> {
  const cursor = new Date().toISOString()
  const cut = since.getTime() - SYNC_DELTA_MARGIN_MS
  const { items, truncated } = await loadOfflineItems()
  const changed = items.filter((item) => Date.parse(item.updatedAt) > cut)
  const { circuits, circuitsOmitted } = await loadOfflineCircuits(items)
  // 書き換わったノートの図は、描き済みでも端末が持っていないことがある (図を
  // 書き足した編集)。新しく描けた図 (created_at) は、ノートが変わっていなくても送る
  const changedFences = await circuitFencesOfMany(changed.map((item) => item.memo))
  const changedKeys = new Set(
    changedFences.flat().map((fence) => circuitKey(fence.lang, fence.source)),
  )
  const sent = circuits.filter(
    (circuit) =>
      circuit.createdAt.getTime() > cut || changedKeys.has(circuitKey(circuit.lang, circuit.source)),
  )
  return {
    mode: 'delta',
    syncedAt: new Date().toISOString(),
    cursor,
    versions: items.map((item) => [item.itemId, item.updatedAt, item.accessedAt, item.pinned ? 1 : 0]),
    items: changed,
    circuits: sent.map(({ createdAt: _createdAt, ...circuit }) => circuit),
    circuitHashes: circuits.flatMap((circuit) => (circuit.hash === undefined ? [] : [circuit.hash])),
    truncated,
    circuitsOmitted,
  }
}

type StoredCircuit = OfflineCircuit & { createdAt: Date }

async function loadOfflineCircuits(
  items: readonly OfflineItem[],
): Promise<{ circuits: StoredCircuit[]; circuitsOmitted: number }> {
  // **印付きを先に並べる。** 予算を超えたときに落ちるのは後ろからなので、
  // 「オフラインで常に使う」と言われたノートの図が最初に犠牲になってはいけない。
  // 同じ優先度の中では引いた順 = 更新の新しい順が残る
  const ordered = [...items].sort((a, b) => Number(b.pinned) - Number(a.pinned))

  // 取り出しは DB の控えから (docs/122 §1)。控えに無い本文だけを解析する。
  // 回路の言語名を含まないノートは引きにも行かない (circuitFencesOfMany の足切り)
  const fencesByItem = await circuitFencesOfMany(ordered.map((item) => item.memo))
  const fences: CircuitFence[] = []
  const seen = new Set<string>()
  for (const itemFences of fencesByItem) {
    for (const fence of itemFences) {
      const key = circuitKey(fence.lang, fence.source)
      if (!seen.has(key)) {
        seen.add(key)
        fences.push(fence)
      }
    }
  }
  if (fences.length === 0) {
    return { circuits: [], circuitsOmitted: 0 }
  }

  // DB の主キーは sha256 なので、引く前にフェンス → hash を作っておく
  // (1 本ずつ 2 回計算しないため。数百件で効く差ではないが、対応表が
  // 1 つあるほうが「どちらの向きで引いたか」を追わずに読める)
  // **言語ごとに版の混ぜ方が違う** (docs/91 §2)。取り違えると描画側と
  // 鍵がずれ、描いてある図をオフラインへ持ち出せない
  const hashOf = new Map(
    fences.map((fence) => [
      circuitKey(fence.lang, fence.source),
      fence.lang === CIRCUITIKZ_LANG
        ? circuitHash(fence.source)
        : circuitYamlHash(fence.source),
    ]),
  )
  // 落ちても本文の同期は続ける。図が出ないだけで、ノートは読める
  const cached = await prisma.circuitSvg
    .findMany({
      where: { hash: { in: [...hashOf.values()] } },
      select: { hash: true, svg: true, createdAt: true },
    })
    .catch((error: unknown) => {
      console.warn('オフライン用の回路図を引けませんでした', error)
      return []
    })
  const rowByHash = new Map(cached.map((row) => [row.hash, row]))

  const circuits: StoredCircuit[] = []
  let budget = OFFLINE_CIRCUIT_BUDGET
  let omitted = 0
  for (const fence of fences) {
    const hash = hashOf.get(circuitKey(fence.lang, fence.source)) ?? ''
    const row = rowByHash.get(hash)
    if (row === undefined) {
      // まだ描かれていない。断らない — オンラインで開けば揃う類のもので、
      // 予算不足 (利用者にできることが無い) とは性質が違う
      continue
    }
    const { svg } = row
    if (svg.length > budget) {
      omitted++
      continue
    }
    budget -= svg.length
    // 取り出す側 (item.ts) が鍵を組み立て直せるよう、言語も一緒に控える
    circuits.push({ source: fence.source, lang: fence.lang, svg, hash, createdAt: row.createdAt })
  }

  return { circuits, circuitsOmitted: omitted }
}
