// 取り込み済みノートの判定 (docs/28-エクスポート計画.md §4 / §5)。
//
// ENEX の取り込み (lib/enex/importEnex.ts) と、ZIP の「新しい番号で取り込む」
// (lib/zip/importZip.ts) が**同じ判定を共有する**。どちらも狙いは同じで、
// 同じファイルを二度流したときに増やさないこと。片方だけ直されて解釈がずれる
// と、再実行の安全という一番効いてほしい性質が黙って落ちる。
//
// items.ts ではなくここに置くのは itemNo.ts と同じ理由 — items.ts は検索・
// ゴミ箱まで抱えた大きな面で、この判定だけを差し替えて確かめられなくなる。
// 依存は prisma 1 つだけにして、テストから通せる形にしておく。

import { prisma } from '@/lib/db'

// 既に取り込んであるノートか。
//
// 照合は「同じ created_at (秒精度) + 同じ題名 (memo 1 行目)」。この組はほぼ
// 一意で、同時刻・同題名で別内容のノートは実用上あり得ない。
//
// **日時の無いノートは判定しない** (常に新規として入れる)。照合の鍵が題名
// だけになり、同名の別ノート (「メモ」「無題」など) を取り違えるため。数が
// 出ても実害は「同名ノートが 2 件」で、日時ありの誤スキップより軽い。
// 題名の無いノートも同じ理由で判定しない。
//
// title 列は無いので memo の 1 行目で見る。ENEX は buildMemo が題名を 1 行目に
// 置き、ZIP は memo をそのまま往復させるので、どちらも 1 行目が題名になる。
// **呼ぶ側が同じ正規化 (ENEX は trim) を通した文字列を渡すこと** — 書き込みと
// 照合で正規化がずれると、同じノートが毎回「新しい」と判定される。
export async function isAlreadyImported(
  createdAt: Date | null,
  title: string,
): Promise<boolean> {
  if (createdAt === null || title === '') {
    return false
  }
  const rows = await prisma.$queryRaw<{ one: number }[]>`
    SELECT 1 AS one FROM items
    WHERE created_at = ${createdAt}
      AND split_part(memo, E'\n', 1) = ${title}
    LIMIT 1
  `
  return rows.length > 0
}
