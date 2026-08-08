// 端末へ持ち出すノート 1 件の形 (docs/65-オフライン対応計画.md)。
//
// サーバ (app/api/sync/items) とクライアント (IndexedDB) が同じ型を見る。
// **Prisma の Item をそのまま流さない**のが要点:
//
//   - Date は JSON を跨ぐと文字列に化ける。型の上でも最初から文字列にしておく。
//     日時の比較は文字列のままできる (order.ts の冒頭に理由を書いた)
//   - props / deletedAt / publicAt は運ばない。オフラインでは特性表もゴミ箱も
//     公開切り替えも出さないので、要らない列を端末へ置かない
//
// 受け取り側は**サーバを無条件に信じない** (searchQueryClient.ts と同じ流儀)。
// 応答は IndexedDB へそのまま沈むので、形の違う値を混ぜると次にオフラインで
// 開いたときに描画側が落ちる — 圏外で初めて気づく壊れ方になる。

import { parseMode, type Mode } from '@/lib/validation'

// 同期の口。クライアントとテストが同じ定数を見る
export const SYNC_ITEMS_PATH = '/api/sync/items'

export interface OfflineItem {
  itemNo: string
  // 番号順の並べ替え用。非数字の itemNo は null (末尾へ回す)
  itemNoNum: number | null
  memo: string
  url: string
  mode: Mode
  // 一覧の見出し (memo 由来の派生列)。**表示ではなく並べ替えに使う** —
  // 見出しの表示は今までどおり memoSummary() をその場で通す (ItemRow と同じ)
  title: string
  tags: string[]
  taskTodo: number
  taskDone: number
  updatedAt: string
  accessedAt: string
}

// 1 回の同期で持ち出すノート数の上限。
//
// 個人利用の実データは数百件 (docs/65 §3-2) なので通常は届かない。それでも上限を
// 置くのは、ノートが桁違いに増えたときに**全件の本文を VPS のメモリへ載せて
// 端末へ流す**のが最初に壊れる場所だから (本番は RAM 2GB)。
// 溢れたら更新の新しい順に打ち切り、切ったことを truncated で伝える —
// 黙って切ると「これで全部」と読めてしまう (searchItemProps の omitted と同じ)。
export const OFFLINE_SYNC_LIMIT = 5000

export interface OfflineSyncPayload {
  // サーバが応答を作った時刻。「最終同期」の表示に使う。**端末時計を使わない** —
  // 圏外で時計がずれた端末でも、いつのデータかはサーバの時刻で言い切れる
  syncedAt: string
  items: OfflineItem[]
  // 上限で打ち切ったか。true なら画面が「一部のみ」と断る
  truncated: boolean
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

// ノート 1 件の検算。1 つでも欠けたら null (呼び出し側がその 1 件を落とす)。
//
// mode だけは倒して受ける — parseMode が url 以外をすべて memo に寄せる規則を
// 持っており (validation.ts)、ここで別の判断をすると表と裏で解釈が割れる。
function parseOfflineItem(value: unknown): OfflineItem | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const row = value as Record<string, unknown>
  if (
    !isNonEmptyString(row.itemNo) ||
    typeof row.memo !== 'string' ||
    typeof row.url !== 'string' ||
    typeof row.title !== 'string' ||
    !Array.isArray(row.tags) ||
    !isFiniteNumber(row.taskTodo) ||
    !isFiniteNumber(row.taskDone) ||
    typeof row.updatedAt !== 'string' ||
    typeof row.accessedAt !== 'string' ||
    !(row.itemNoNum === null || isFiniteNumber(row.itemNoNum))
  ) {
    return null
  }
  return {
    itemNo: row.itemNo,
    itemNoNum: row.itemNoNum,
    memo: row.memo,
    url: row.url,
    mode: parseMode(row.mode),
    title: row.title,
    // 配列の中の非文字列は落とすだけ。タグは絞り込みにしか使わないので、
    // 1 つ欠けてもノート本体は読める (件ごと捨てるほうが損)
    tags: row.tags.filter((tag): tag is string => typeof tag === 'string'),
    taskTodo: row.taskTodo,
    taskDone: row.taskDone,
    updatedAt: row.updatedAt,
    accessedAt: row.accessedAt,
  }
}

// 同期 API の data 部を読み取る。封筒が壊れていれば null (同期を失敗にする)。
//
// **1 件の形式違いでは失敗にしない**のが要点。全部を捨てると、圏外で開いた
// ときにノートが 1 つも出ない — 原因の見えない壊れ方になる。落とした件数は
// 呼び出し側 (sync.ts) が items.length の差で知り、ログに残す。
export function parseSyncPayload(data: unknown): OfflineSyncPayload | null {
  if (typeof data !== 'object' || data === null) {
    return null
  }
  const { syncedAt, items } = data as { syncedAt?: unknown; items?: unknown }
  if (!isNonEmptyString(syncedAt) || !Array.isArray(items)) {
    return null
  }
  return {
    syncedAt,
    items: items.flatMap((row) => {
      const item = parseOfflineItem(row)
      return item === null ? [] : [item]
    }),
    // 旗が読めなければ「切っていない」に倒す。断りを出さないほうへ倒すのは、
    // 出し損ねても一覧が欠けるだけなのに対し、誤って出すと毎回の同期で
    // 嘘の警告が居座るため
    truncated: (data as { truncated?: unknown }).truncated === true,
  }
}
