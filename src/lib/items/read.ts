// ノートを読む側の DB 操作 (1 件・採番・タグ集計・フォルダーの件数・前後ナビ)。
// 検索一覧は search.ts、ゴミ箱は trash.ts が持つ (docs/93-リファクタリング計画.md §4-1)。
import 'server-only'
import { prisma } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'
import type { Item } from '@/generated/prisma/client'
import { firstUnusedNo, MIN_ITEM_NO } from '@/lib/items/itemNo'
import { orderByClause } from '@/lib/prefs/sortOrder'
import type { Sort } from '@/lib/validation'
import { buildNeighborsWhere, termCondition } from './where'

// ゴミ箱のノートも返す (フィルタしない)。QR シールから開いた /item は
// ゴミ箱でも本文を見せてバナーと復元を出すため (docs/12-ゴミ箱計画.md §5)。
export async function getItem(itemNo: string): Promise<Item | null> {
  return prisma.item.findUnique({ where: { itemNo } })
}

// その画像が「公開中のノートの本文に貼られているか」(docs/22 §6)。
// 未ログインの人に画像を配ってよいかの判定に使う。閉じたままだと、公開ノートを
// 開いた人には本文だけ出て画像が割れる。
//
// **LIKE は使えない**。この DB には PGroonga が入っていて LIKE の挙動を
// 乗っ取っているため、部分一致は position() で判定する。
//
// 名前が UUID であることは根拠にしない (route.ts のコメントのとおり、
// 当てにくさは認証の代わりにならない)。呼ぶ側が isValidImageName で
// 書式を確かめてから渡すこと。
//
// ゴミ箱の行を外すのは isPublicItem() と同じ理由。判定の条件が 2 か所に
// 分かれてしまうが、こちらは「どの行か」が判らないので SQL で書くしかない。
export async function isPublicImageName(name: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ one: number }[]>`
    SELECT 1 AS one FROM items
    WHERE public_at IS NOT NULL
      AND deleted_at IS NULL
      AND position(${name} IN memo) > 0
    LIMIT 1
  `
  return rows.length > 0
}

// 新規ノートに使う itemNo (docs/10-スキャン新規登録計画.md §4)。
// MIN_ITEM_NO 以上で未使用の最小番号。max+1 だと番号が増える一方だが、
// 番号はシールに印刷して部品に貼るものなので短いほど扱いやすい。
//
// 非数字の itemNo は item_no_num が null なので where で自然に外れる。
// 全件引いて JS で隙間を探す。index 済みの列で 500 件規模なら、SQL の
// gap 検索を書くより読める形の方がよい。
//
// ゴミ箱 (deleted_at 非 null) の行は**意図的に外さない**。ゴミ箱にある間は
// その番号を使用中として飛ばすことで、復元するまで番号を予約する
// (削除→新規作成→復元で番号が衝突するのを防ぐ)。番号が解放されるのは
// 永久削除で行が消えたときだけ (docs/12-ゴミ箱計画.md §4)。
//
// 予約はしない。番号が競合するのは別タブで同時に作ったときだけで、単一
// ユーザでは実質起きない。万一先を越されても、編集ページは既存ノートなら
// その本文を表示する (事前入力しない) ので開いた瞬間に気づける。
//
// alsoUsed は「DB にはまだ無いが使用中とみなす番号」。ZIP の取り込みで衝突した
// ノートに番号を振るとき (docs/28 §5「新しい番号で取り込む」)、**同じ ZIP の
// 中でまだ書いていないノートの番号**を渡す。これが無いと、空き番号がたまたま
// ZIP 側の別ノートの番号だったときにそれを横取りしてしまい、衝突していな
// かったノートまで後から衝突する (元の番号のまま入るという約束が崩れる)。
export async function nextItemNo(alsoUsed: readonly number[] = []): Promise<string> {
  const rows = await prisma.item.findMany({
    where: { itemNoNum: { gte: MIN_ITEM_NO } },
    select: { itemNoNum: true },
    orderBy: { itemNoNum: 'asc' },
  })
  const used = rows.flatMap((row) => (row.itemNoNum === null ? [] : [row.itemNoNum]))
  // firstUnusedNo は昇順を前提にする (重複は読み飛ばせる)
  const usedAsc = alsoUsed.length === 0 ? used : [...used, ...alsoUsed].sort((a, b) => a - b)
  return String(firstUnusedNo(usedAsc, MIN_ITEM_NO))
}

export interface TagCount {
  tag: string
  count: number
}

// 全ノートのタグを件数つきで集計する (件数降順・同数はタグ名昇順)。
// 検索窓のタグ補完・タグ一覧に使う。個人利用でタグ総数は小さい前提。
// ゴミ箱のノートは数えない (検索で引けないタグを補完に出さないため)。
export async function listTags(): Promise<TagCount[]> {
  return prisma.$queryRaw<TagCount[]>`
    SELECT tag, count(*)::int AS count
    FROM (SELECT unnest(tags) AS tag FROM items WHERE deleted_at IS NULL) AS t
    GROUP BY tag
    ORDER BY count DESC, tag ASC
  `
}

export interface FolderTotals {
  total: number
  untagged: number
}

// 検索フォルダーの件数 (docs/86 §5)。「すべて」と「未分類」を 1 回の
// seq scan で数える。未分類の条件は termCondition の untagged を**そのまま
// 埋め込む** — フォルダーは検索のエイリアスなので、バッジの数字と
// クリックした結果 (is:untagged 検索) の件数がずれてはいけない。
// 定義を書き写すと、片方だけ直した日に静かに食い違う
export async function countFolderTotals(): Promise<FolderTotals> {
  const rows = await prisma.$queryRaw<FolderTotals[]>`
    SELECT count(*)::int AS total,
           (count(*) FILTER (WHERE ${termCondition({ kind: 'untagged' })}))::int AS untagged
    FROM items WHERE deleted_at IS NULL
  `
  return rows[0] ?? { total: 0, untagged: 0 }
}

// 一覧の中での隣 (docs/60-学習進捗計画.md §4)。itemNo が一覧の何番目かを
// 探さずに、SQL の lag/lead で前後 1 件だけを返す。
export interface ListNeighbors {
  prev: string | null
  next: string | null
}

// **検索条件に「今のノート自身」を OR で足してから並べる**のが要点。
// ノートを開いている間にチェックを付けると `is:todo` の一覧からは消えるが、
// それでも「次」は正しく次のノートを指さなければならない。自分を足しておけば
// 本来の並び位置に差し込まれ、前後が求まる (一覧に残っているときは足しても
// 結果が変わらないので、場合分けは要らない)。
//
// 未登録の itemNo (QR シールだけ貼った番号) では一致する行が無く、
// 前後とも null になる = 呼び出し側はナビを出さない。
export async function findListNeighbors(
  query: string,
  sort: Sort,
  itemNo: string,
): Promise<ListNeighbors> {
  // 並び順は prefs/sortOrder.ts の定数のみ (buildOrderBy と同じ理由で raw に通せる)。
  // WINDOW 句で 1 度だけ書き、lag と lead が必ず同じ並びを見るようにする
  const rows = await prisma.$queryRaw<ListNeighbors[]>`
    WITH ordered AS (
      SELECT item_no,
             lag(item_no)  OVER w AS prev,
             lead(item_no) OVER w AS next
      FROM items
      ${buildNeighborsWhere(query, itemNo)}
      WINDOW w AS (ORDER BY ${Prisma.raw(orderByClause(sort))})
    )
    SELECT prev, next FROM ordered WHERE item_no = ${itemNo}
  `
  return { prev: rows[0]?.prev ?? null, next: rows[0]?.next ?? null }
}
