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
import {
  CIRCUITIKZ_LANG,
  type CircuitLang,
  isCircuitLang,
} from '@/lib/fenceLanguages'

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
  // 「オフラインで常に使う」印 (docs/65-オフライン対応計画.md §7)。
  // true のノートは添付の原寸・シークレット断片まで端末へ持ち出す
  // (pinCache.ts)。表示にも使う — 印の付いたノートは一覧で見分けられる
  pinned: boolean
}

// 端末へ持ち出す回路図 1 枚 (docs/65-オフライン対応計画.md §8)。
//
// **フェンスの中身そのものを鍵にする**。サーバ側のキャッシュ (circuit_svgs) は
// sha256 を鍵にしているが、その計算には Node の crypto が要り、写すと
// RENDERER_VERSION の混ぜ方まで二重に持つことになる。MarkdownView が引くのは
// フェンスの中身 (trim 済み) なので、そのまま鍵にすれば写す規則がゼロで済む。
export interface OfflineCircuit {
  // 回路フェンスの中身 (trim 済み)
  source: string
  // どちらの回路フェンスか (docs/91)。**古い保存には無い** — その頃は
  // circuitikz しか無かったので、欠けていたら circuitikz とみなす
  lang: CircuitLang
  // 描画済みの SVG。サーバ側で assertSafeCircuitSvg を通ったものだけを運ぶ
  svg: string
}

// 1 回の同期で持ち出すノート数の上限。
//
// 個人利用の実データは数百件 (docs/65 §3-2) なので通常は届かない。それでも上限を
// 置くのは、ノートが桁違いに増えたときに**全件の本文を VPS のメモリへ載せて
// 端末へ流す**のが最初に壊れる場所だから (本番は RAM 2GB)。
// 溢れたら更新の新しい順に打ち切り、切ったことを truncated で伝える —
// 黙って切ると「これで全部」と読めてしまう (searchItemProps の omitted と同じ)。
export const OFFLINE_SYNC_LIMIT = 5000

// 1 回の同期で運ぶ回路図の総量 (docs/65-オフライン対応計画.md §8)。
//
// 本文が全件で数百 KB なのに対し、TikZ の SVG は 1 枚で数十 KB になる。
// 上限を置かないと、回路図の多いノートが増えた日から**同期そのものが重くなる**
// — しかも増えるのは端末側の保存量だけでなく、VPS (RAM 2GB) が 1 応答のために
// 積む文字列の量でもある。
//
// 4MB は「実データ (598 件) の回路図をすべて積んでも余る」量から採った。
// 溢れたら印付き (pinned) を先に積み、残りを更新の新しい順で埋める。
export const OFFLINE_CIRCUIT_BUDGET = 4 * 1024 * 1024

export interface OfflineSyncPayload {
  // サーバが応答を作った時刻。「最終同期」の表示に使う。**端末時計を使わない** —
  // 圏外で時計がずれた端末でも、いつのデータかはサーバの時刻で言い切れる
  syncedAt: string
  items: OfflineItem[]
  // 上限で打ち切ったか。true なら画面が「一部のみ」と断る
  truncated: boolean
  // 描画済みの回路図 (docs/65-オフライン対応計画.md §8)。
  // **サーバ側のキャッシュにある分だけ**で、ここで描き足しはしない
  circuits: OfflineCircuit[]
  // 予算 (OFFLINE_CIRCUIT_BUDGET) に入り切らず運べなかった回路図の数。
  // 黙って落とすと「圏外でだけ図が出ない」原因の掴めない差になる
  circuitsOmitted: number
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
    // 旗が読めなければ「印なし」に倒す。誤って true にすると、印を付けて
    // いないノートの添付まで黙って落とし始める (通信量を払うのは利用者)
    pinned: row.pinned === true,
  }
}

// 回路図 1 枚の検算。source か svg が欠けたら null (その 1 枚だけ落とす)。
//
// **中身の妥当性 (SVG として安全か) はここでは見ない**。検査の正本は
// サーバ側の assertSafeCircuitSvg で、写すと二重管理になる。ここを通った
// 文字列は dangerouslySetInnerHTML へ渡るが、経路はオンライン時と同じ
// (同じ口が返した同じ文字列) なので、増える危険はない。
function parseOfflineCircuit(value: unknown): OfflineCircuit | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const row = value as Record<string, unknown>
  if (!isNonEmptyString(row.source) || !isNonEmptyString(row.svg)) {
    return null
  }
  return {
    source: row.source,
    // 知らない綴りも circuitikz へ倒す。図は既に描けているので、
    // 言語を読み損ねただけで持ち出しを捨てる理由がない
    lang: isCircuitLang(row.lang) ? row.lang : CIRCUITIKZ_LANG,
    svg: row.svg,
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
  const { syncedAt, items, circuits, circuitsOmitted } = data as {
    syncedAt?: unknown
    items?: unknown
    circuits?: unknown
    circuitsOmitted?: unknown
  }
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
    // 回路図は**無くても本文は読める** (コードブロックとして出る) ので、
    // 配列でなければ空に倒す。古い版のアプリが書いた保存を読み直すときに
    // ここへ来る (db.ts は保存も parseSyncPayload に通す)
    circuits: Array.isArray(circuits)
      ? circuits.flatMap((row) => {
          const circuit = parseOfflineCircuit(row)
          return circuit === null ? [] : [circuit]
        })
      : [],
    circuitsOmitted:
      typeof circuitsOmitted === 'number' && Number.isFinite(circuitsOmitted)
        ? circuitsOmitted
        : 0,
  }
}
