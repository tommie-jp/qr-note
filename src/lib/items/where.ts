// 検索式 (AST) と一覧の並びを SQL の断片にする層 (docs/93-リファクタリング計画.md §4-1)。
//
// **DB に触らない。** ここにあるのは Prisma.sql で断片を組み立てるだけの
// 純関数と定数で、クエリを撃つのは items/ の他のモジュール。db.ts を
// 巻き込まないので DATABASE_URL 無しでテストできる (where.test.ts)。
//
// server-only なのは Prisma の値 import が実行時 (@prisma/client/runtime) を
// 引き込むため。SQL の断片はサーバーでしか意味を持たない。
import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import { parseSearchExpr } from '@/lib/search/parse'
import { stripTaskTerms } from '@/lib/search/rewrite'
import type { SearchExpr, SearchTerm } from '@/lib/search/types'
import { orderByClause } from '@/lib/sortOrder'
import { escapeLike, type TrashSort } from '@/lib/validation'

// 検索語 1 語ぶんの WHERE 条件を組み立てる。
// text: memo / url は PGroonga の全文一致 (&@, 日本語バイグラム・全半角/大小の
//   正規化つき)、itemNo は前方一致 (ILIKE, 旧データの英字入り itemNo に備え大小無視)。
// tag: items.tags 配列の完全一致 (@>, GIN インデックスが効く)。
//   タグ名は search/tokenize.ts が正規化済み (NFKC + 小文字化)。
// 語種ごとに必ず case を書く (exprCondition と同じ網羅 switch)。
// text へ落ちる既定にすると、種別を足したときに黙って全文検索へ流れる
export function termCondition(term: SearchTerm): Prisma.Sql {
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
// PGroonga に生で届くことはない (search/parse.ts 冒頭の設計)。
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

export const NOT_TRASHED = Prisma.sql`deleted_at IS NULL`
export const TRASHED = Prisma.sql`deleted_at IS NOT NULL`
const HAS_PROPS = Prisma.sql`props <> '[]'::jsonb`
// 進捗の対象 = チェックを 1 つ以上持つノート (docs/60-学習進捗計画.md §2)。
// チェックの無いノートを分母に入れると、混ざった瞬間に率が嘘になる
const HAS_TASKS = Prisma.sql`(task_todo > 0 OR task_done > 0)`
// 完了 = 全部チェックした。「一部だけ付いた」を済みに数えない
export const ALL_CHECKED = Prisma.sql`(task_done > 0 AND task_todo = 0)`

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
export function buildWhere(query: string): Prisma.Sql {
  return buildWhereFrom([NOT_TRASHED, buildQueryCondition(query)])
}

// 特性表の WHERE 句。検索条件に加えてプロパティを持つノートだけへ絞る。
export function buildPropsWhere(query: string): Prisma.Sql {
  return buildWhereFrom([NOT_TRASHED, buildQueryCondition(query), HAS_PROPS])
}

// 進捗の表の WHERE 句。検索条件に加えてチェックを持つノートだけへ絞る。
export function buildChecksWhere(query: string): Prisma.Sql {
  return buildWhereFrom([NOT_TRASHED, buildQueryCondition(query), HAS_TASKS])
}

// ゴミ箱側の WHERE 句 (ゴミ箱一覧と、0 件検索時の案内)。検索と同じ条件を
// 裏返すだけ。空クエリのときは「ゴミ箱にある」だけが残り、一覧の全件になる。
export function buildTrashedWhere(query: string): Prisma.Sql {
  return buildWhereFrom([TRASHED, buildQueryCondition(query)])
}

// 学習進捗の母数の WHERE 句 (docs/60-学習進捗計画.md §2)。検索から
// チェック語を外し、チェックを持つノートだけへ絞る。分子 (全部チェックした
// ノート) は countTaskProgress が同じ WHERE の FILTER で数える
export function buildProgressWhere(query: string): Prisma.Sql {
  return buildWhereFrom([
    NOT_TRASHED,
    buildQueryCondition(query, true),
    HAS_TASKS,
  ])
}

// 一覧の前後ナビの WHERE 句。検索条件に「今のノート自身」を OR で足す
// (理由は read.ts の findListNeighbors のコメント)。空クエリなら全件が
// 対象なので足さない
export function buildNeighborsWhere(query: string, itemNo: string): Prisma.Sql {
  const condition = buildQueryCondition(query)
  const scope =
    condition === null
      ? null
      : Prisma.sql`${condition} OR item_no = ${itemNo}`
  return buildWhereFrom([NOT_TRASHED, scope])
}

// 生 SQL で 1 件ぶんを引くときの列。camelCase へ射影して既存の Item 型に
// 合わせる (findMany と同じ形)。検索一覧とゴミ箱一覧の両方が同じ Item[] を
// 返すので、列の並びを 2 か所に書かない — 片方にだけ列を足すと、そちらでしか
// 使えない Item が生まれる。
export const ITEM_COLUMNS = Prisma.sql`
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
export function buildOrderBy(sort: TrashSort): Prisma.Sql {
  return Prisma.raw(`ORDER BY ${orderByClause(sort)}`)
}
