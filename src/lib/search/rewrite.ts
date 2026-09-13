// 解析済みの検索式を読む・書き換える純関数 (search/ の 3 段目)。
// 特性表を出すか・学習進捗を出すかの判定と、進捗の母数や表の行リンク用に
// 式を組み替える道具を置く。解析そのものは parse.ts (文法も parse.ts 冒頭)。

import { parseSearchExpr, pruneTerms } from './parse'
import { QUOTE } from './tokenize'
import type { SearchExpr, SearchTerm } from './types'

// 条件に当たる葉があるか。throughNot が false なら否定の中は見ない。
function someTerm(
  expr: SearchExpr,
  pred: (term: SearchTerm) => boolean,
  throughNot: boolean,
): boolean {
  switch (expr.op) {
    case 'term':
      return pred(expr.term)
    case 'not':
      return throughNot && someTerm(expr.child, pred, throughNot)
    case 'and':
    case 'or':
      return expr.children.some((child) => someTerm(child, pred, throughNot))
  }
}

const isTaskTerm = (term: SearchTerm): boolean => term.kind === 'task'

// クエリが肯定形のタグ項を含むか。
// 特性表を出すかの判定に使う: 表は「同族の部品を並べて比べる」ビューであり、
// タグ検索がまさにその族の指定だから (docs/08-プロパティ計画.md)。
// 否定 (`!#npn` = 「npn 以外すべて」) は族の指定にならないため数えない。
export function queryHasTagTerm(query: string): boolean {
  const expr = parseSearchExpr(query)
  // 否定の中は見ない (`!#npn` = 「npn 以外すべて」は族の指定にならない)
  return expr !== null && someTerm(expr, (t) => t.kind === 'tag', false)
}

// 検索式からチェック状態の葉 (`is:todo` / `is:done`) を取り除く。
// 学習進捗の**母数**は「今の検索からチェックの条件だけ外した集合」なので、
// その条件式をここで作る (docs/60-学習進捗計画.md §2)。
export function stripTaskTerms(expr: SearchExpr): SearchExpr | null {
  return pruneTerms(expr, (term) => !isTaskTerm(term))
}

// 「チェックを 1 つ以上持つ」を検索文法で書いた式。items/where.ts の HAS_TASKS
// (`task_todo > 0 OR task_done > 0`) と同じ集合を指す (is:todo = task_todo > 0、
// is:done = task_done > 0)。
const HAS_CHECKS_QUERY = 'is:todo OR is:done'

// 検索式に「チェックを持つ」条件を AND で足す (docs/77-進捗マトリックス計画.md §7)。
//
// 進捗の表の行は「検索ヒットのうちチェックを持つノート」で、その絞りは SQL 側
// (buildChecksWhere の HAS_TASKS) が掛けている。ところが行のリンクが運ぶ `q` は
// 素の検索式なので、開いた先の前後ナビ (findListNeighbors) は**表より広い集合**を
// 歩く。20 件ヒットのうち 9 件がチェックを持つ表で「次」を押すと、表に無い
// 11 件のどれかへ飛び、「表 → 1 問目 → 次 → … と回って戻ってこられる」
// (docs/60 §4) という約束が崩れる。
//
// **集合は URL の `q` だけで決まる形に畳む。** `checks=1` のような印を別に
// 足す案は採らない — ノートの「一覧へ」は `q` から一覧の URL を組むので、
// 印を知らない一覧が表と違う件数を出す。式で書ける絞りは式で書く。
// findListNeighbors に絞り専用の引数を足す案も同じ理由で採らない。
//
// 括弧で包むのは優先順位のため。優先順位は AND > OR なので `#a OR #b` に
// 裸で足すと `#a OR (#b AND チェック)` になり、#a 側の絞りが消える。
//
// 承知しておく限界: 語数の上限 (MAX_SEARCH_TERMS) 近くまで語を書いた式では、
// 足した 2 語が capTerms に丸められて絞りが効かない (今までどおり広い集合を
// 歩く) か、`is:todo` だけ残って逆に狭くなる。フェンスの検索式は
// `#電験三種 !#後回し` 程度なので実際には届かない上限だが、届いたときは
// 表そのものも同じ capTerms で丸められている。
export function narrowToChecks(query: string): string {
  const trimmed = query.trim()
  // 空の検索式 (絞り込みなし = チェックを持つ全ノート) でも**条件だけは載せる**。
  // 空に畳むと buildItemUrl が `q` ごと落とし、並び順まで落ちる (`q` が無ければ
  // 一覧の文脈が無いという約束) ので、前後ナビが cookie の並びで歩き出す
  if (trimmed === '') {
    return HAS_CHECKS_QUERY
  }
  // 引用を閉じ忘れた式をそのまま包むと、閉じ括弧も足した条件も**引用の中身**に
  // 食われる (未閉じ引用は行末までリテラル)。絞りが消えるうえ、表とは違う語
  // (`abc) (is:todo OR is:done)`) を検索することになる。
  //
  // **閉じてから包む。** 行末で閉じるのと閉じ忘れは同じ意味なので、これで
  // 元の式の意味は変わらない (パーサが閉じ忘れの括弧を自動クローズするのと
  // 同じ手当て。壊れた入力は「それらしく」解釈する)
  const closed = hasUnclosedQuote(trimmed) ? `${trimmed}${QUOTE}` : trimmed
  return `(${closed}) (${HAS_CHECKS_QUERY})`
}

function hasUnclosedQuote(query: string): boolean {
  return [...query].filter((char) => char === QUOTE).length % 2 === 1
}

// 最上位の AND に並んでいる項。AND でなければ式そのものが唯一の項。
function conjuncts(expr: SearchExpr): SearchExpr[] {
  return expr.op === 'and' ? expr.children : [expr]
}

// その項が `is:todo` / `!is:done` のような裸のチェック語か。
function isTaskCondition(expr: SearchExpr): boolean {
  if (expr.op === 'not') {
    return isTaskCondition(expr.child)
  }
  return expr.op === 'term' && isTaskTerm(expr.term)
}

// 検索結果に学習の進捗を出してよいか (docs/60-学習進捗計画.md §2)。
//
// 母数は stripTaskTerms でチェック語を外した式で数えるので、**外した式が
// 元の結果の上位集合でなければ数が嘘になる**。それが保証できるのは
// チェック語が最上位の AND に並んでいるとき (`#英単語 is:todo` /
// `#英単語 !is:todo`) だけ — AND から項を抜けば式は必ず広がる。
//
// OR の枝から葉を抜くと逆に狭まるので、`#英単語 OR is:todo` のような式では
// 出さない。40 件出ている脇に「チェック完了 3 / 5」と、一覧と無関係な
// 母数が並ぶことになるため。
export function queryTracksTaskProgress(query: string): boolean {
  const expr = parseSearchExpr(query)
  if (expr === null) {
    return false
  }
  const top = conjuncts(expr)
  // 裸のチェック語**以外**の項の中に潜んでいるチェック語 (OR の枝や
  // `!(is:todo #難)` の中) があれば、母数が上位集合にならない
  if (top.some((c) => !isTaskCondition(c) && someTerm(c, isTaskTerm, true))) {
    return false
  }
  return top.some(isTaskCondition)
}
