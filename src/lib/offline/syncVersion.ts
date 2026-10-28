// オフライン同期の「変化が無ければ本文を送らない」ための版 (docs/118 §4-2)。
//
// 同期の多くは「前回から何も変わっていない」。それでも毎回 11MB (gzip で 2.3MB)
// を組んで送るのは無駄なので、応答に ETag を付け、端末が If-None-Match で
// 送り返してきたら 304 で返す。
//
// **本文を組む前に、安い問い合わせ 1 本で決める。** 本文を組んでからハッシュ
// すると、DB の読みと JSON 化を毎回払うことになる。
//
// 拾うもの (それぞれ同期の中身を変える操作):
//   live     … 生きているノートの数 (追加・永久削除)
//   updated  … 最終更新 (編集・取り込み)
//   accessed … 最終アクセス (開いた順。端末側の並びに使う)
//   deleted  … 最終削除 (ゴミ箱と復元。**updated_at を触らない**。items/trash.ts)
//   pinned   … 印の数 (docs/65 §7-3。これも updated_at を触らない)
//   svgs     … 描画済み回路図の数 (ノートを開くと増える。同期は描画済みだけ運ぶ)
//
// max(updated_at) だけでは代用できない (ゴミ箱と印が動かない。docs/118 §4-2)
import 'server-only'
import { prisma } from '@/lib/db'

export interface SyncVersionRow {
  live: number
  updated: Date | null
  accessed: Date | null
  deleted: Date | null
  pinned: number
  svgs: number
}

const ms = (d: Date | null): number => (d === null ? 0 : d.getTime())

// HTTP の ETag の形 (引用符つき)。弱い印 (W/) は使わない — 同じ値なら本文は
// バイト単位で同じ
export function formatSyncEtag(row: SyncVersionRow): string {
  return `"${row.live}-${ms(row.updated)}-${ms(row.accessed)}-${ms(row.deleted)}-${row.pinned}-${row.svgs}"`
}

export async function loadSyncEtag(): Promise<string> {
  const rows = await prisma.$queryRaw<SyncVersionRow[]>`
    SELECT count(*) FILTER (WHERE deleted_at IS NULL)::int AS live,
           max(updated_at) AS updated,
           max(accessed_at) AS accessed,
           max(deleted_at) AS deleted,
           count(*) FILTER (WHERE offline_pin AND deleted_at IS NULL)::int AS pinned,
           (SELECT count(*)::int FROM circuit_svgs) AS svgs
    FROM items
  `
  return formatSyncEtag(
    rows[0] ?? { live: 0, updated: null, accessed: null, deleted: null, pinned: 0, svgs: 0 },
  )
}
