import { prisma } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'
import type { Item } from '@/generated/prisma/client'
import { assertDemoItemQuota } from '@/lib/demoQuota'
import type { HealthSourceRow } from '@/lib/healthSeries'
import { firstUnusedNo, MIN_ITEM_NO } from '@/lib/itemNo'
import type { MatrixSourceRow } from '@/lib/matrixTable'
import { memoSummary } from '@/lib/memoSummary'
import { replaceImageName } from '@/lib/memoImages'
import {
  extractProps,
  parseStoredProps,
  type ItemPropsRow,
} from '@/lib/props'
import {
  parseSearchExpr,
  stripTaskTerms,
  type SearchExpr,
  type SearchTerm,
} from '@/lib/search'
import { orderByClause } from '@/lib/sortOrder'
import { extractTags } from '@/lib/tags'
import { countTasks } from '@/lib/taskCheckbox'
import {
  escapeLike,
  itemNoToNum,
  type Mode,
  type Sort,
  type TrashSort,
} from '@/lib/validation'

export const PAGE_SIZE = 20

// 特性表に載せるノート数の上限。一覧のページ送り (PAGE_SIZE) とは独立で、
// ページを開いても表は検索ヒット全体で一定になるようにする。
// 個人利用で 1 タグに数百件も付かない前提の安全弁。
export const PROPS_TABLE_LIMIT = 200

// 進捗の表 (docs/77-進捗マトリックス計画.md) に載せるノート数の上限。
// 特性表と同じ考え方 — 表として読める大きさと、本文をまとめて取ってよい
// 大きさが同じところにある。
export const MATRIX_ROW_LIMIT = 200

// 健康グラフ (docs/83-健康管理フェンス計画.md) が本文を読むノート数の上限。
// 上の 2 つと同じ 200。**こちらは SQL 側の絞りを持たない**のが違いで
// (「チェックを持つ」に当たる派生列が無い)、絞りは検索式だけが担う。
// タグを書かずに置かれたフェンスが全ノートを舐めないための止め弁でもある。
export const HEALTH_ROW_LIMIT = 200

// ゴミ箱のノートも返す (フィルタしない)。QR シールから開いた /item は
// ゴミ箱でも本文を見せてバナーと復元を出すため (docs/12-ゴミ箱計画.md §5)。
export async function getItem(itemNo: string): Promise<Item | null> {
  return prisma.item.findUnique({ where: { itemNo } })
}

// --- 公開 (docs/22-ノート公開計画.md) ---

// ノートを公開する / 公開をやめる。
//
// 「いまの状態を裏返す」ではなく**望む状態を受け取る**。裏返す作りは、
// 二重送信や戻るボタンで意図と逆に倒れる (「1 にせよ」なら何回でも 1)。
//
// updated_at は触らない。本文は変わっていないのに更新順が動くのは嘘になる
// (trashItems / restoreItems と同じ理由)。Prisma の update は @updatedAt を
// 必ず打ってしまうので生 SQL で書く。
//
// WHERE の状態条件が要点: 既に公開中のノートへもう一度「公開」しても
// public_at を上書きしない。押し直すたびに公開日時が今へ進むのは嘘になる。
export async function setItemPublic(itemNo: string, isPublic: boolean): Promise<number> {
  if (isPublic) {
    return prisma.$executeRaw`
      UPDATE items SET public_at = now()
      WHERE item_no = ${itemNo} AND public_at IS NULL
    `
  }
  return prisma.$executeRaw`
    UPDATE items SET public_at = NULL
    WHERE item_no = ${itemNo} AND public_at IS NOT NULL
  `
}

// --- オフラインの印 (docs/65-オフライン対応計画.md §7) ---

// 「オフラインで常に使う」印を立てる / 下ろす。
//
// **updated_at を触らない**ので生 SQL で書く (setItemPublic と同じ理由)。
// 印は読み方の設定であって本文の変更ではないため、付けただけで更新順の
// 先頭に来るのは嘘になる — しかも同期は更新の新しい順に打ち切るので、
// 動かすと「印を付けたノートが他を押し出す」という別の嘘まで生む。
export async function setItemOfflinePin(itemNo: string, pinned: boolean): Promise<number> {
  return prisma.$executeRaw`
    UPDATE items SET offline_pin = ${pinned}
    WHERE item_no = ${itemNo} AND offline_pin <> ${pinned}
  `
}

// --- アクセス順 (docs/37-アクセス順計画.md) ---

// 連打・二重発火を吸収する間隔。リロードや React の StrictMode で
// 同じノートの記録が続けて飛んでくるため
const ACCESS_THROTTLE = '1 minute'

// ノートを「開いた」ことを記録する。
//
// **updated_at は触らない**。見ただけで更新順が動くのは嘘になる
// (trashItems / setItemPublic と同じ理由)。Prisma の update は @updatedAt を
// 必ず打ってしまうので生 SQL で書く。
//
// WHERE の時刻条件は連打よけ。1 分以内に既に記録済みなら何もしない
// (更新行数 0 が正常な結果なので、戻り値で成否を判断しないこと)。
//
// ゴミ箱の行も記録してよい。ゴミ箱から開いて中身を確かめることはあり、
// 復元したときに「最近見た」順で見つかるほうが自然。
export async function recordItemAccess(itemNo: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE items SET accessed_at = now()
    WHERE item_no = ${itemNo}
      AND accessed_at < now() - ${ACCESS_THROTTLE}::interval
  `
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

// Ver1 の /item/:itemNo と同じく、未登録なら新規作成する (upsert)。
// tags / props は memo から抽出した派生キャッシュ (保存のたびに再計算する)。
export async function upsertMemo(itemNo: string, memo: string): Promise<Item> {
  // デモのノート数上限 (docs/39-デモ公開計画.md §2-2)。新規作成になるときだけ
  // 効く (デモでなければ即 return)。既存の更新は数に依らず通す
  await assertDemoItemQuota(itemNo)
  const derived = derivedFromMemo(memo)
  return prisma.item.upsert({
    where: { itemNo },
    update: { memo, ...derived },
    create: { itemNo, itemNoNum: itemNoToNum(itemNo), memo, ...derived },
  })
}

export async function upsertItem(
  itemNo: string,
  data: { memo: string; url: string; mode: Mode },
): Promise<Item> {
  // デモのノート数上限 (docs/39-デモ公開計画.md §2-2)。upsertMemo と同じ門番
  await assertDemoItemQuota(itemNo)
  const derived = derivedFromMemo(data.memo)
  return prisma.item.upsert({
    where: { itemNo },
    update: { ...data, ...derived },
    create: { itemNo, itemNoNum: itemNoToNum(itemNo), ...data, ...derived },
  })
}

// 取り込んだノートの作成・更新日時を、元のファイルが持っていた値に戻す
// (ENEX インポート = docs/28 §4 / ZIP インポート = 同 §3)。
//
// Prisma の update は @updatedAt を必ず「いま」で打ってしまうので生 SQL で書く
// (setItemPublic / trashItems と同じ理由)。これをしないと取り込んだ全ノートが
// 同じ時刻に並び、更新順の一覧が意味をなさなくなる。
//
// **accessed_at は触らない** (docs/37-アクセス順計画.md §5)。列の既定値
// (now()) のまま = 取り込んだ時刻が入る。これで取り込んだノートが
// 「アクセス順」の先頭に並び、古い日時 (Evernote 由来の 2012 年など) で
// 埋もれずに済む — インポートの目的そのもの。
//
// どちらか片方しか無いときはもう片方で埋める。両方無ければ何もしない
// (取り込んだ時刻のまま = upsert が入れた値)。
export async function applyImportedTimestamps(
  itemNo: string,
  createdAt: Date | null,
  updatedAt: Date | null,
): Promise<void> {
  const created = createdAt ?? updatedAt
  const updated = updatedAt ?? createdAt
  if (created === null || updated === null) {
    return
  }
  await prisma.$executeRaw`
    UPDATE items SET created_at = ${created}, updated_at = ${updated}
    WHERE item_no = ${itemNo}
  `
}

// 本文に貼った画像を回転したとき、旧 URL を新 URL に書き換える
// (docs/49-画像回転計画.md §3)。回転は画像を新 UUID で保存し直すため、その名前を
// 参照している本文をすべて追随させる。返り値は書き換えたノート数。
//
// **ゴミ箱の行も含めて**全件を対象にする — deleted_at で絞らない。復元したときに
// 旧 URL のまま画像切れになるのを避ける。1 枚の画像を複数ノートが参照していても
// (docs/20 §1) すべて揃って新しい向きになる。
//
// 対象探しは `position(name IN memo) > 0`。**LIKE は使わない** — PGroonga が
// LIKE を全文一致に乗っ取るため、部分一致は position() で見る
// (isPublicImageName と同じ流儀)。派生列 (tags/props) も再計算に乗せる
// (upsertMemo と同じ)。競合を避けるためトランザクションで囲む。
export async function rewriteImageReference(
  oldName: string,
  newName: string,
): Promise<number> {
  const rows = await prisma.$queryRaw<{ item_no: string; memo: string }[]>`
    SELECT item_no, memo FROM items
    WHERE position(${oldName} IN memo) > 0
  `
  if (rows.length === 0) {
    return 0
  }
  await prisma.$transaction(
    rows.map((row) => {
      const memo = replaceImageName(row.memo, oldName, newName)
      return prisma.item.update({
        where: { itemNo: row.item_no },
        data: { memo, ...derivedFromMemo(memo) },
      })
    }),
  )
  return rows.length
}

// memo 由来の派生キャッシュ列。正本は memo なので保存のたびに丸ごと作り直す。
// 書き込み経路 (upsertMemo / upsertItem) を 1 箇所に集約して、再計算漏れを防ぐ。
function derivedFromMemo(memo: string) {
  const tasks = countTasks(memo)
  return {
    // 一覧の見出し。並べ替え専用の列で、表示は今までどおり ItemRow が
    // memoSummary() をその場で通す (docs/63-タイトル順計画.md §3)
    title: memoSummary(memo),
    tags: extractTags(memo),
    props: extractProps(memo),
    taskTodo: tasks.todo,
    taskDone: tasks.done,
  }
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

export interface ItemSearchResult {
  items: Item[]
  total: number
  page: number
  pageCount: number
}

// 検索語 1 語ぶんの WHERE 条件を組み立てる。
// text: memo / url は PGroonga の全文一致 (&@, 日本語バイグラム・全半角/大小の
//   正規化つき)、itemNo は前方一致 (ILIKE, 旧データの英字入り itemNo に備え大小無視)。
// tag: items.tags 配列の完全一致 (@>, GIN インデックスが効く)。
//   タグ名は search.ts が正規化済み (NFKC + 小文字化)。
// 語種ごとに必ず case を書く (exprCondition と同じ網羅 switch)。
// text へ落ちる既定にすると、種別を足したときに黙って全文検索へ流れる
function termCondition(term: SearchTerm): Prisma.Sql {
  switch (term.kind) {
    case 'tag':
      return Prisma.sql`tags @> ARRAY[${term.value}]::text[]`
    // チェック状態 (docs/56-チェック検索計画.md §5)。
    // is:todo = 未チェックが 1 つ以上残っている、is:done = チェック済みがある。
    // 否定は上位の NOT がそのまま効く (列は NOT NULL なので三値論理で化けない)
    case 'task':
      return term.value === 'todo'
        ? Prisma.sql`task_todo > 0`
        : Prisma.sql`task_done > 0`
    // タグの無いノート (docs/86 §5 未分類フォルダー)。tags は NOT NULL の
    // 配列なので cardinality だけで判定できる (NULL の三値論理は出ない)
    case 'untagged':
      return Prisma.sql`cardinality(tags) = 0`
    case 'text': {
      const likePrefix = `${escapeLike(term.value)}%`
      return Prisma.sql`(memo &@ ${term.value} OR url &@ ${term.value} OR item_no ILIKE ${likePrefix})`
    }
  }
}

// 検索式 (AST) を条件式へ再帰的にコンパイルする。
// 各ノードを括弧で包むので、木の入れ子がそのまま演算子の優先順位になる。
//   `抵抗 1608 OR コンデンサ` → ((抵抗) AND (1608)) OR ((コンデンサ))
//   `#bjt !(#npn OR #pnp)`   → (#bjt) AND (NOT ((#npn) OR (#pnp)))
// 葉は termCondition がすべてパラメータとして渡すため、演算子構文が
// PGroonga に生で届くことはない (search.ts 冒頭の設計)。
// NOT が三値論理で化けないのは memo/url/tags が NOT NULL だから
// (prisma/schema.prisma。NULL 混入時は NOT NULL → NULL で行が落ちる)。
function exprCondition(expr: SearchExpr): Prisma.Sql {
  switch (expr.op) {
    case 'term':
      return termCondition(expr.term)
    case 'not':
      return Prisma.sql`NOT (${exprCondition(expr.child)})`
    case 'and':
      return Prisma.sql`(${Prisma.join(expr.children.map(exprCondition), ' AND ')})`
    case 'or':
      return Prisma.sql`(${Prisma.join(expr.children.map(exprCondition), ' OR ')})`
  }
}

// 検索クエリの条件式 (WHERE は付けない)。空クエリ (絞り込みなし) なら null。
//
// stripTasks … チェック語 (`is:todo` / `is:done`) を外した式にする。
// 学習進捗の母数「今の検索からチェックの条件だけ外した集合」を数えるときだけ
// true にする (docs/60-学習進捗計画.md §2)。
function buildQueryCondition(
  query: string,
  stripTasks = false,
): Prisma.Sql | null {
  const parsed = parseSearchExpr(query)
  const expr = parsed !== null && stripTasks ? stripTaskTerms(parsed) : parsed
  return expr === null ? null : exprCondition(expr)
}

const NOT_TRASHED = Prisma.sql`deleted_at IS NULL`
const TRASHED = Prisma.sql`deleted_at IS NOT NULL`
const HAS_PROPS = Prisma.sql`props <> '[]'::jsonb`
// 進捗の対象 = チェックを 1 つ以上持つノート (docs/60-学習進捗計画.md §2)。
// チェックの無いノートを分母に入れると、混ざった瞬間に率が嘘になる
const HAS_TASKS = Prisma.sql`(task_todo > 0 OR task_done > 0)`
// 完了 = 全部チェックした。「一部だけ付いた」を済みに数えない
const ALL_CHECKED = Prisma.sql`(task_done > 0 AND task_todo = 0)`

// 条件を AND で綴じて WHERE 句にする (null の条件は無視する)。
// 各条件を括弧で包むのが要点。検索条件は最上位が OR (`(…) OR (…)`) に
// なりうるので、裸で AND すると OR より AND が強く結合して条件が壊れる。
function buildWhereFrom(conditions: (Prisma.Sql | null)[]): Prisma.Sql {
  const present = conditions
    .filter((c) => c !== null)
    .map((c) => Prisma.sql`(${c})`)
  return Prisma.sql`WHERE ${Prisma.join(present, ' AND ')}`
}

// 検索の WHERE 句。空クエリ (一覧ブラウズ) でもゴミ箱は必ず外す。
function buildWhere(query: string): Prisma.Sql {
  return buildWhereFrom([NOT_TRASHED, buildQueryCondition(query)])
}

// 特性表の WHERE 句。検索条件に加えてプロパティを持つノートだけへ絞る。
function buildPropsWhere(query: string): Prisma.Sql {
  return buildWhereFrom([NOT_TRASHED, buildQueryCondition(query), HAS_PROPS])
}

// 進捗の表の WHERE 句。検索条件に加えてチェックを持つノートだけへ絞る。
function buildChecksWhere(query: string): Prisma.Sql {
  return buildWhereFrom([NOT_TRASHED, buildQueryCondition(query), HAS_TASKS])
}

// ゴミ箱側の WHERE 句 (ゴミ箱一覧と、0 件検索時の案内)。検索と同じ条件を
// 裏返すだけ。空クエリのときは「ゴミ箱にある」だけが残り、一覧の全件になる。
function buildTrashedWhere(query: string): Prisma.Sql {
  return buildWhereFrom([TRASHED, buildQueryCondition(query)])
}

// 生 SQL で 1 件ぶんを引くときの列。camelCase へ射影して既存の Item 型に
// 合わせる (findMany と同じ形)。検索一覧とゴミ箱一覧の両方が同じ Item[] を
// 返すので、列の並びを 2 か所に書かない — 片方にだけ列を足すと、そちらでしか
// 使えない Item が生まれる。
const ITEM_COLUMNS = Prisma.sql`
  item_no     AS "itemNo",
  item_no_num AS "itemNoNum",
  memo,
  url,
  mode,
  title,
  tags,
  props,
  task_todo   AS "taskTodo",
  task_done   AS "taskDone",
  created_at  AS "createdAt",
  updated_at  AS "updatedAt",
  accessed_at AS "accessedAt",
  deleted_at  AS "deletedAt",
  public_at   AS "publicAt"
`

// ソート句。PGroonga のスコアは小テーブルで seq scan になり効かないため、
// 関連度順は採用せず現行の更新順/番号順/アクセス順を維持する
// (docs/04-全文検索計画.md §3-4、docs/37-アクセス順計画.md)。
//
// 句の組み立ては sortOrder.ts の純関数が持つ (DATABASE_URL 無しでテストする
// ため)。**Prisma.raw に渡してよいのは、あちらが自前の定数しか返さないから** —
// 引数の文字列が SQL へ混ざる余地はない (sortOrder.ts のコメントと対)。
function buildOrderBy(sort: TrashSort): Prisma.Sql {
  return Prisma.raw(`ORDER BY ${orderByClause(sort)}`)
}

// q は memo / url の全文検索 (&@)、または itemNo の前方一致。
// 空白 (半角/全角) 区切りは AND、"OR"/"|" は OR (DNF)。文法は search.ts 参照。
//
// page N は「N ページ目の 20 件」ではなく「1〜N ページ目の累積」を返す
// (docs/33-オンデマンド表示計画.md §2)。オンデマンド表示の要:
// クライアントは蓄積 state を持たず、URL の ?page=N だけで表示範囲が決まる。
// 毎回先頭から引き直すので OFFSET 型の重複/欠落も起きない。
// 個人規模 (数百〜数千件) では全件でも誤差 (docs/15 §2-2 と同じ判断)。
export async function searchItems(
  query: string,
  page: number,
  sort: Sort = 'updated',
): Promise<ItemSearchResult> {
  const where = buildWhere(query)

  const totalRows = await prisma.$queryRaw<{ count: number }[]>`
    SELECT count(*)::int AS count FROM items ${where}
  `
  const total = totalRows[0]?.count ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  // floor が要る: ?page=1.5 のような値をそのまま掛けると LIMIT 30 になり、
  // 半端な page が次ページの URL にも伝播する
  const intPage = Math.floor(page)
  const safePage = Math.min(
    Math.max(1, Number.isFinite(intPage) ? intPage : 1),
    pageCount,
  )
  const limit = safePage * PAGE_SIZE

  const items = await prisma.$queryRaw<Item[]>`
    SELECT ${ITEM_COLUMNS}
    FROM items
    ${where}
    ${buildOrderBy(sort)}
    LIMIT ${limit}
  `

  return { items, total, page: safePage, pageCount }
}

export interface ItemPropsResult {
  rows: ItemPropsRow[]
  // 上限を超えて表に載らなかった件数。黙って打ち切ると「これで全部」と
  // 読めてしまうため、呼び出し側が知らせられるように数を返す。
  omitted: number
}

// 特性表の元データ。検索ヒットのうちプロパティを持つノートを、一覧と同じ並びで返す。
// 一覧のページ送りとは独立に全ヒットを対象にするため、LIMIT は PAGE_SIZE ではなく
// PROPS_TABLE_LIMIT (ページを開いても表の中身が変わらないように)。
// 要約はここで作り、memo 全文をクライアントへ送らない。
export async function searchItemProps(
  query: string,
  sort: Sort = 'updated',
): Promise<ItemPropsResult> {
  const where = buildPropsWhere(query)
  // 上限より 1 件だけ多く取り、溢れているかを 1 クエリで判定する
  // (件数用に count を撃つより安い)。
  const rows = await prisma.$queryRaw<
    { itemNo: string; memo: string; props: unknown }[]
  >`
    SELECT item_no AS "itemNo",
           memo,
           props
    FROM items
    ${where}
    ${buildOrderBy(sort)}
    LIMIT ${PROPS_TABLE_LIMIT + 1}
  `

  const omitted =
    rows.length > PROPS_TABLE_LIMIT
      ? (await countItemsWhere(where)) - PROPS_TABLE_LIMIT
      : 0

  return {
    rows: rows.slice(0, PROPS_TABLE_LIMIT).map((row) => ({
      itemNo: row.itemNo,
      summary: memoSummary(row.memo),
      props: parseStoredProps(row.props),
    })),
    omitted,
  }
}

// 溢れたときだけ本当の総数を数える (通常の検索では撃たない)。
async function countItemsWhere(where: Prisma.Sql): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    SELECT count(*)::int AS count FROM items ${where}
  `
  return rows[0]?.count ?? 0
}

export interface ItemChecksResult {
  rows: MatrixSourceRow[]
  // 上限を超えて表に載らなかった件数 (特性表と同じ約束。黙って打ち切らない)
  omitted: number
}

// 進捗の表の元データ (docs/77-進捗マトリックス計画.md §4)。
// **特性表 (searchItemProps) の双子** — 絞りが「プロパティを持つ」から
// 「チェックを持つ」に変わり、取る列が props から task_todo/task_done に
// 変わるだけで、上限・溢れ・並びの作法はそのまま。
//
// memo を返すのは、行の見出し (要約) とチェックの名前の両方が本文から
// 決まるため。クライアントへ渡る形へ畳むのは buildMatrixTable の仕事で、
// そこで memo は捨てられる。
export async function searchItemChecks(
  query: string,
  sort: Sort = 'itemNo',
): Promise<ItemChecksResult> {
  const where = buildChecksWhere(query)
  // 上限より 1 件だけ多く取り、溢れているかを 1 クエリで判定する
  const rows = await prisma.$queryRaw<MatrixSourceRow[]>`
    SELECT item_no   AS "itemNo",
           memo,
           task_todo AS "taskTodo",
           task_done AS "taskDone"
    FROM items
    ${where}
    ${buildOrderBy(sort)}
    LIMIT ${MATRIX_ROW_LIMIT + 1}
  `

  const omitted =
    rows.length > MATRIX_ROW_LIMIT
      ? (await countItemsWhere(where)) - MATRIX_ROW_LIMIT
      : 0

  return { rows: rows.slice(0, MATRIX_ROW_LIMIT), omitted }
}

export interface ItemHealthResult {
  rows: HealthSourceRow[]
  // 上限を超えて読まなかったノート数 (特性表・進捗の表と同じ約束)
  omitted: number
}

// 健康グラフの元データ (docs/83-健康管理フェンス計画.md §5)。
// 進捗の表 (searchItemChecks) の三つ子だが、違いが 2 つある。
//
// **絞りが検索式しかない。** 「チェックを持つ」(HAS_TASKS) に当たる派生列が
// 無いので、記録を持たないノートも上限の 200 件に数えられる。だから
// フェンスにはタグを書く前提で、そのぶん LIMIT が実質的な安全弁になる。
//
// **並び順を選ばせない。** 健康の記録は日付を本文に持っており、並べ替えは
// 集計 (healthSeries) が日付で行う。ここでの順が意味を持つのは「同じ日付が
// 2 つあったらどちらを採るか」だけなので、毎回同じ答えになる番号順で固定する。
export async function searchItemHealth(query: string): Promise<ItemHealthResult> {
  const where = buildWhere(query)
  // 上限より 1 件だけ多く取り、溢れているかを 1 クエリで判定する
  const rows = await prisma.$queryRaw<HealthSourceRow[]>`
    SELECT item_no AS "itemNo",
           memo
    FROM items
    ${where}
    ${buildOrderBy('itemNo')}
    LIMIT ${HEALTH_ROW_LIMIT + 1}
  `

  const omitted =
    rows.length > HEALTH_ROW_LIMIT
      ? (await countItemsWhere(where)) - HEALTH_ROW_LIMIT
      : 0

  return { rows: rows.slice(0, HEALTH_ROW_LIMIT), omitted }
}

// --- ゴミ箱 (二段階削除。docs/12-ゴミ箱計画.md) ---

// ゴミ箱へ入れる / 戻す。どちらも updated_at は触らない。本文は変わって
// いないので、削除・復元で更新順が動くのは嘘になるため。Prisma の
// updateMany は @updatedAt を必ず打ってしまうので生 SQL で書く。
export async function trashItems(itemNos: string[]): Promise<number> {
  if (itemNos.length === 0) {
    return 0
  }
  return prisma.$executeRaw`
    UPDATE items SET deleted_at = now()
    WHERE item_no IN (${Prisma.join(itemNos)}) AND deleted_at IS NULL
  `
}

export async function restoreItems(itemNos: string[]): Promise<number> {
  if (itemNos.length === 0) {
    return 0
  }
  return prisma.$executeRaw`
    UPDATE items SET deleted_at = NULL
    WHERE item_no IN (${Prisma.join(itemNos)}) AND deleted_at IS NOT NULL
  `
}

// 永久削除 (DB から消す)。**ゴミ箱にある行しか消さない**のがこの関数の要点で、
// 二段階削除の保証はここにある (UI ではなくサーバ側で担保する)。
// ここで初めて itemNo が解放され、新規ノートに再利用されうる。
//
// 戻り値は件数ではなく**実際に消えた itemNo の列**。呼び出し側 (actions.ts) が
// git の墓石コミットの対象を決めるのに使う — 渡された itemNos をそのまま
// 使うと、ゴミ箱に無くて消えなかったノートの履歴まで墓石が立ってしまう
// (docs/57-ノートgit履歴計画.md §4)。先に SELECT してから消す間に別タブが
// 割り込む競合は理屈上あるが、deleteMany 側の deleted_at 条件が守りの正本で、
// ずれても墓石が 1 回分ずれるだけ (シングルユーザーでは実質起きない)。
export async function purgeItems(itemNos: string[]): Promise<string[]> {
  if (itemNos.length === 0) {
    return []
  }
  const rows = await prisma.item.findMany({
    where: { itemNo: { in: itemNos }, deletedAt: { not: null } },
    select: { itemNo: true },
  })
  if (rows.length === 0) {
    return []
  }
  const targets = rows.map((row) => row.itemNo)
  await prisma.item.deleteMany({
    where: { itemNo: { in: targets }, deletedAt: { not: null } },
  })
  return targets
}

// purgeItems と同じ約束で、消えた itemNo の列を返す (墓石コミットの対象)。
export async function emptyTrash(): Promise<string[]> {
  const rows = await prisma.item.findMany({
    where: { deletedAt: { not: null } },
    select: { itemNo: true },
  })
  if (rows.length === 0) {
    return []
  }
  const targets = rows.map((row) => row.itemNo)
  await prisma.item.deleteMany({
    where: { itemNo: { in: targets }, deletedAt: { not: null } },
  })
  return targets
}

// ゴミ箱の一覧。既定は削除の新しい順で、検索一覧と同じ 4 種別にも並べ替えられる
// (docs/67-ゴミ箱表示形式計画.md §2)。個人利用で数件しか溜まらない前提なので
// ページ送りは無い (「ゴミ箱を空にする」の件数が全件を指す前提でもある)。
//
// **要約ではなく Item をそのまま返す。** 以前は itemNo/summary/deletedAt の
// 3 つだけを返して memo 全文をクライアントへ送らないようにしていたが、
// 大表示の本文プレビューも画像表示のタイルも本文から作るので、要約では
// 描けない。検索一覧 (searchItems) は元から Item[] を返しており、そちらと
// 同じ扱いになるだけ。
export async function listTrashedItems(
  sort: TrashSort = 'deleted',
): Promise<Item[]> {
  return prisma.$queryRaw<Item[]>`
    SELECT ${ITEM_COLUMNS}
    FROM items
    ${buildTrashedWhere('')}
    ${buildOrderBy(sort)}
  `
}

export async function countTrashedItems(): Promise<number> {
  return prisma.item.count({ where: { deletedAt: { not: null } } })
}

// 検索が 0 件のとき、同じ条件がゴミ箱に当たるかを数える (docs/12 §5)。
// 「消したノートを探して 0 件」や、ゴミ箱のノートと同じコードの再スキャンで
// 二重登録しかけたときに、ゴミ箱へ誘導するために使う。0 件のときしか撃たない。
export async function countTrashedMatches(query: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    SELECT count(*)::int AS count FROM items ${buildTrashedWhere(query)}
  `
  return rows[0]?.count ?? 0
}

// 学習の進捗 (docs/60-学習進捗計画.md §2)。
// total … 検索からチェック語を外し「チェックを持つ」で絞った件数 (母数)
// done  … そのうち全部チェックしたノート
export interface TaskProgress {
  done: number
  total: number
}

// `#過渡現象 is:todo` のような検索でも、母数は `#過渡現象` のうち
// チェックを持つノート全体になる。**同じ WHERE を 2 度引かない** —
// FILTER 付きの集約 1 本で分母と分子を同時に数える (件数と食い違わない)。
export async function countTaskProgress(query: string): Promise<TaskProgress> {
  const where = buildWhereFrom([
    NOT_TRASHED,
    buildQueryCondition(query, true),
    HAS_TASKS,
  ])
  const rows = await prisma.$queryRaw<TaskProgress[]>`
    SELECT count(*)::int AS total,
           (count(*) FILTER (WHERE ${ALL_CHECKED}))::int AS done
    FROM items
    ${where}
  `
  return { done: rows[0]?.done ?? 0, total: rows[0]?.total ?? 0 }
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
  const condition = buildQueryCondition(query)
  const scope =
    condition === null
      ? null
      : Prisma.sql`${condition} OR item_no = ${itemNo}`
  // 並び順は sortOrder.ts の定数のみ (buildOrderBy と同じ理由で raw に通せる)。
  // WINDOW 句で 1 度だけ書き、lag と lead が必ず同じ並びを見るようにする
  const rows = await prisma.$queryRaw<ListNeighbors[]>`
    WITH ordered AS (
      SELECT item_no,
             lag(item_no)  OVER w AS prev,
             lead(item_no) OVER w AS next
      FROM items
      ${buildWhereFrom([NOT_TRASHED, scope])}
      WINDOW w AS (ORDER BY ${Prisma.raw(orderByClause(sort))})
    )
    SELECT prev, next FROM ordered WHERE item_no = ${itemNo}
  `
  return { prev: rows[0]?.prev ?? null, next: rows[0]?.next ?? null }
}
