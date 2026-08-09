// 同期 API がノートを引くところ (docs/65-オフライン対応計画.md §3-1)。
//
// **サーバ専用**。prisma を読むので、クライアントから import してはいけない
// (共有したい型と定数は item.ts が持つ。thumbnail.ts が定数のつもりの import で
// sharp をクライアントへ漏らした件と同じ落とし穴)。
//
// 差分同期はしない。全ノートで数百 KB しかなく (docs/65 §3-2)、差分にすると
// 「消えたノートを端末からも消す」処理が別に要る — 毎回まるごと置き換えれば、
// 端末側は常にサーバの写しになり、消えたノートも自然に消える。

import { prisma } from '@/lib/db'
import { CIRCUIT_LANG, extractCircuitSources } from '@/lib/circuitFences'
import { circuitHash } from '@/lib/circuitikz'
import {
  OFFLINE_CIRCUIT_BUDGET,
  OFFLINE_SYNC_LIMIT,
  type OfflineCircuit,
  type OfflineItem,
  type OfflineSyncPayload,
} from './item'

// ゴミ箱のノートは運ばない。オフラインではゴミ箱も復元も出さないので、
// 端末に置いても検索を濁らせるだけになる。
//
// 上限に届いたときのために更新の新しい順で引く。打ち切るなら、最近書いた
// ものが残るほうが現場で役に立つ (docs/65 の想定は「棚の前で引く」)。
export async function loadOfflineSyncPayload(): Promise<OfflineSyncPayload> {
  // 上限より 1 件だけ多く取り、溢れているかを 1 クエリで判定する
  // (件数用に count を撃つより安い。searchItemProps と同じ手)
  const rows = await prisma.item.findMany({
    where: { deletedAt: null },
    select: {
      itemNo: true,
      itemNoNum: true,
      memo: true,
      url: true,
      mode: true,
      title: true,
      tags: true,
      taskTodo: true,
      taskDone: true,
      updatedAt: true,
      accessedAt: true,
      offlinePin: true,
    },
    orderBy: [{ updatedAt: 'desc' }, { itemNo: 'asc' }],
    take: OFFLINE_SYNC_LIMIT + 1,
  })

  const truncated = rows.length > OFFLINE_SYNC_LIMIT
  const items: OfflineItem[] = rows.slice(0, OFFLINE_SYNC_LIMIT).map(({ offlinePin, ...row }) => ({
    ...row,
    // Date は JSON を跨ぐと文字列に化けるので、型のうえでも先に文字列にする。
    // toISOString の形 (桁数・UTC 固定) は order.ts が辞書順の比較で使う
    updatedAt: row.updatedAt.toISOString(),
    accessedAt: row.accessedAt.toISOString(),
    pinned: offlinePin,
  }))

  const { circuits, circuitsOmitted } = await loadOfflineCircuits(items)

  return {
    // サーバの時刻を正にする (端末の時計を信じない。item.ts の syncedAt 参照)
    syncedAt: new Date().toISOString(),
    items,
    truncated,
    circuits,
    circuitsOmitted,
  }
}

// 持ち出すノートの ```circuitikz を、描画済みのものだけ集める
// (docs/65-オフライン対応計画.md §8)。
//
// **ここでは描かない。** 1 枚あたり最大 10 秒かかる TeX の描画 (circuitikz.ts の
// CIRCUIT_TIMEOUT_MS) を同期の口に載せると、回路図を書き足した直後の同期だけが
// 数十秒かかる — しかも待っているのは本文の同期でもある。描くのは
//   - ノートを開いたとき (ItemView の renderCircuits)
//   - 印を付けたとき (actions.ts の setItemOfflinePinAction)
// の 2 か所で、ここは出来上がっている物を配るだけにする。まだ描かれていない
// フェンスは圏外でコードブロックとして出る (オンラインで一度開けば揃う)。
async function loadOfflineCircuits(
  items: readonly OfflineItem[],
): Promise<{ circuits: OfflineCircuit[]; circuitsOmitted: number }> {
  // **印付きを先に並べる。** 予算を超えたときに落ちるのは後ろからなので、
  // 「オフラインで常に使う」と言われたノートの図が最初に犠牲になってはいけない。
  // 同じ優先度の中では引いた順 = 更新の新しい順が残る
  const ordered = [...items].sort((a, b) => Number(b.pinned) - Number(a.pinned))

  const sources: string[] = []
  const seen = new Set<string>()
  for (const item of ordered) {
    // remark の解析は全ノートに掛けると安くない。フェンス言語の文字列を
    // 含まないノートは**必ず**回路図を持たないので、そこで先に落とす
    // (``` でも ~~~ でも言語名は本文に現れる)
    if (!item.memo.includes(CIRCUIT_LANG)) {
      continue
    }
    for (const source of extractCircuitSources(item.memo)) {
      if (!seen.has(source)) {
        seen.add(source)
        sources.push(source)
      }
    }
  }
  if (sources.length === 0) {
    return { circuits: [], circuitsOmitted: 0 }
  }

  // DB の主キーは sha256 なので、引く前にフェンス → hash を作っておく
  // (1 本ずつ 2 回計算しないため。数百件で効く差ではないが、対応表が
  // 1 つあるほうが「どちらの向きで引いたか」を追わずに読める)
  const hashOf = new Map(sources.map((source) => [source, circuitHash(source)]))
  // 落ちても本文の同期は続ける。図が出ないだけで、ノートは読める
  const cached = await prisma.circuitSvg
    .findMany({ where: { hash: { in: [...hashOf.values()] } }, select: { hash: true, svg: true } })
    .catch((error: unknown) => {
      console.warn('オフライン用の回路図を引けませんでした', error)
      return []
    })
  const svgByHash = new Map(cached.map((row) => [row.hash, row.svg]))

  const circuits: OfflineCircuit[] = []
  let budget = OFFLINE_CIRCUIT_BUDGET
  let omitted = 0
  for (const source of sources) {
    const svg = svgByHash.get(hashOf.get(source) ?? '')
    if (svg === undefined) {
      // まだ描かれていない。断らない — オンラインで開けば揃う類のもので、
      // 予算不足 (利用者にできることが無い) とは性質が違う
      continue
    }
    if (svg.length > budget) {
      omitted++
      continue
    }
    budget -= svg.length
    circuits.push({ source, svg })
  }

  return { circuits, circuitsOmitted: omitted }
}
