// 全文検索の検索語ユーティリティ。
// pgroonga への SQL 組み立ては items.ts が行い、ここでは
// ユーザー入力の解析だけを純関数として扱う (DB 非依存でテストしやすくするため)。
//
// 検索窓の文法 (詳細は docs/05-全文検索の使い方.md / docs/16-論理演算検索計画.md)。
// Lucene (Elasticsearch) / Obsidian 系の文法に揃えてある:
//
//   expr    := orExpr
//   orExpr  := andExpr ( ("OR" | "|") andExpr )*
//   andExpr := unary+                    ← 空白の並置 = 暗黙 AND
//   unary   := ("!" | "！")* primary     ← NOT (重ねがけは打ち消し)
//   primary := "(" expr ")" | 語 | #タグ | is:todo | is:done | "引用リテラル"
//
//   - 優先順位は NOT > 空白 (AND) > OR。SQL・Lucene と同じ。
//     例: `抵抗 1608 OR コンデンサ` → (抵抗 AND 1608) OR コンデンサ
//   - 演算子は全角でも書ける (`＃` を全角で受けるのと同じ入力ゆれの吸収)。
//     全角スペース / `｜` / `ＯＲ` / `！` / `（）` はそれぞれ半角と同じ。
//   - 否定は Google 式の `-` ではなく `!`。`-40℃` `2SC1815-GR` のように
//     ハイフン始まり/ハイフン入りの語が普通に出てくるドメインだから。
//   - ダブルクォートで囲むと演算子解釈を抑止したリテラル語になる。
//     これは**特別な語すべてに効く逃げ道**で、演算子・`#タグ`・`is:` を問わない。
//     例: `"or"` は OR 演算子ではなく語 "or"、`"A|B"` は語 "A|B"、`"!"` は語 "!"、
//     `"#tag"` はタグ検索でない語 "#tag"、`"is:todo"` は語 "is:todo"
//   - 引用されていない `#○○` はタグ検索 (items.tags の完全一致)。
//     `#` 単独は無視。
//   - 引用されていない `is:todo` / `is:done` はチェック状態の絞り込み
//     (items.task_todo / task_done。docs/56-チェック検索計画.md)。
//     `is:` に続く値がそれ以外 (`is:foo`) なら、ただの語として全文検索に落とす。
//   - 壊れた入力は例外にせず「それらしく」解釈する (未閉じ引用と同じ思想)。
//     閉じ忘れの `(` は自動クローズ、余った `)` と空括弧と裸の `!` は無視。
//
// 生の演算子構文は &@ に渡さず、ここで素の語 (AST の葉) に分解してから
// items.ts がパラメータとして渡す (構文エラー/エスケープ漏れを避ける)。

import { normalizeTag, parseTagToken } from '@/lib/tags'

// チェック状態の絞り込み (docs/56-チェック検索計画.md §5)。
// todo = 未チェックの項目が残っている、done = チェック済みの項目がある。
export type TaskState = 'todo' | 'done'

// 検索語 1 つ。text は全文検索 (memo/url) + itemNo 前方一致、
// tag は items.tags の完全一致、task は items.task_todo / task_done の個数。
export type SearchTerm =
  | { kind: 'text'; value: string }
  | { kind: 'tag'; value: string }
  | { kind: 'task'; value: TaskState }

// 検索式の抽象構文木。items.ts がこれを再帰的に WHERE 句へコンパイルする。
// DNF (選言標準形) へ展開しないのは、括弧と NOT の組み合わせで項が
// 指数的に増えうるため。木のままなら入力サイズに比例した SQL で済む。
export type SearchExpr =
  | { op: 'term'; term: SearchTerm }
  | { op: 'not'; child: SearchExpr }
  | { op: 'and'; children: SearchExpr[] }
  | { op: 'or'; children: SearchExpr[] }

// 1 クエリあたりの語数の上限 (式全体の葉の数)。
// 語数分だけ WHERE 条件が増えるため、極端に長い入力を防ぐ安全弁。
export const MAX_SEARCH_TERMS = 10

// 引用されていない単独語がこれ (全半角・大小を吸収して比較) のとき OR 演算子。
const OR_KEYWORD = 'or'
const QUOTE = '"'
// 演算子はすべて全角も半角と同一視する (全角スペース・`＃` の扱いと揃える。
// 日本語キーボードからの入力ゆれの吸収。docs/16 §2)。
const PIPE_CHARS = '|｜'
const NOT_CHARS = '!！'
const LPAREN_CHARS = '(（'
const RPAREN_CHARS = ')）'

// チェック状態の絞り込み語の接頭辞 (`is:todo` / `is:done`)。
// 全角 (`ＩＳ：`) も NFKC で畳まれてここに一致する
const TASK_PREFIX = 'is:'

function isSpace(ch: string): boolean {
  return /[\s　]/.test(ch)
}

// `is:todo` / `is:done` なら状態を、そうでなければ null を返す。
// **知らない値 (`is:foo`) は null に落とす** — 例外にも 0 件にもせず、
// ただの語として全文検索へ回す。壊れた入力は「それらしく」解釈する流儀
// (未閉じ引用と同じ)。本文に is:foo と書いたノートが出るほうが説明できる
function parseTaskToken(token: string): TaskState | null {
  const normalized = normalizeTag(token)
  if (!normalized.startsWith(TASK_PREFIX)) {
    return null
  }
  const value = normalized.slice(TASK_PREFIX.length)
  return value === 'todo' || value === 'done' ? value : null
}

type Token =
  | { type: 'term'; term: SearchTerm }
  | { type: 'or' }
  | { type: 'not' }
  | { type: 'lparen' }
  | { type: 'rparen' }

// 溜めた文字 1 つ分をトークンにする。捨てる語なら null。
//
// 引用された語 (quoted) は**どの特別扱いにも入らない**のがこの関数の要点。
// `"or"` / `"#tag"` / `"is:todo"` はすべてただの検索語になる — 特別な語を
// 増やしても、引用という逃げ道は 1 か所の分岐で効き続ける。
function tokenFor(buf: string, quoted: boolean): Token | null {
  if (buf.length === 0) {
    return null
  }
  if (quoted) {
    return { type: 'term', term: { kind: 'text', value: buf } }
  }
  // 正規化 (NFKC + 小文字化) はタグ名と共通の規則。`ＯＲ` も OR 演算子になる。
  if (normalizeTag(buf) === OR_KEYWORD) {
    return { type: 'or' }
  }
  const taskState = parseTaskToken(buf)
  if (taskState !== null) {
    return { type: 'term', term: { kind: 'task', value: taskState } }
  }
  const tag = parseTagToken(buf)
  if (tag !== null) {
    return { type: 'term', term: { kind: 'tag', value: tag } }
  }
  // `#`/`＃` 単独 (タグ名が空) は無視する。文字どおり検索したいときは "#"。
  if (buf === '#' || buf === '＃') {
    return null
  }
  return { type: 'term', term: { kind: 'text', value: buf } }
}

// 1 パスの状態機械で入力をトークン列へ分解する。
// 引用内は空白・`|`・`OR`・`!`・括弧をすべて文字として扱い、引用を含む語は
// 演算子/タグに昇格させない (これが `"or"` `"!"` をリテラルにする仕組み)。
// 括弧は引用外では常に単独トークン (`#bjt(!#npn)` と詰めて書ける)。
// `!` はトークン先頭でのみ演算子 (`a!b` の `!` はリテラル文字のまま)。
function tokenize(query: string): Token[] {
  const tokens: Token[] = []
  let buf = ''
  let hasChars = false // 現トークンに文字が入ったか (空引用 "" の検出用)
  let quotedHere = false // 現トークンが引用を含むか (演算子/タグ昇格の抑止用)

  const flush = () => {
    // 出口は 1 つだけ。トークンを積んだかに関わらず、必ずここで状態を戻す
    // (種別ごとに早期 return を書くと、リセットの書き漏れが次の語へ漏れる)
    if (hasChars) {
      const token = tokenFor(buf, quotedHere)
      if (token !== null) {
        tokens.push(token)
      }
    }
    buf = ''
    hasChars = false
    quotedHere = false
  }

  let i = 0
  while (i < query.length) {
    const ch = query[i]
    if (ch === QUOTE) {
      quotedHere = true
      hasChars = true
      i++
      while (i < query.length && query[i] !== QUOTE) {
        buf += query[i]
        i++
      }
      i++ // 閉じ quote を読み飛ばす (未閉じなら while が末尾で終わっており無害)
      continue
    }
    if (isSpace(ch) || PIPE_CHARS.includes(ch)) {
      flush()
      if (PIPE_CHARS.includes(ch)) tokens.push({ type: 'or' })
      i++
      continue
    }
    if (LPAREN_CHARS.includes(ch) || RPAREN_CHARS.includes(ch)) {
      flush()
      tokens.push({ type: LPAREN_CHARS.includes(ch) ? 'lparen' : 'rparen' })
      i++
      continue
    }
    // 直前が flush 済み (= トークン先頭) のときだけ NOT 演算子。
    if (NOT_CHARS.includes(ch) && !hasChars) {
      tokens.push({ type: 'not' })
      i++
      continue
    }
    buf += ch
    hasChars = true
    i++
  }
  flush()
  return tokens
}

// 対応の取れない括弧を捨て/補って、パーサが括弧の釣り合いだけは前提にできる
// ようにする。閉じ忘れの `(` は末尾で自動クローズ、余った `)` は捨てる。
function balanceParens(tokens: Token[]): Token[] {
  const balanced: Token[] = []
  let depth = 0
  for (const token of tokens) {
    if (token.type === 'rparen') {
      if (depth === 0) continue // 対応する `(` がない `)` は捨てる
      depth--
    } else if (token.type === 'lparen') {
      depth++
    }
    balanced.push(token)
  }
  const missing: Token[] = Array.from({ length: depth }, () => ({ type: 'rparen' }))
  return [...balanced, ...missing]
}

// 部分式の同一判定・畳み込み用キー (構造と値で一意)。
// 種別ごとに接頭辞を変え、`text:A` と AND グループなどが衝突しないようにする。
function exprKey(expr: SearchExpr): string {
  switch (expr.op) {
    case 'term':
      return `${expr.term.kind}:${expr.term.value}`
    case 'not':
      return `!(${exprKey(expr.child)})`
    case 'and':
      return `&(${expr.children.map(exprKey).join(',')})`
    case 'or':
      return `|(${expr.children.map(exprKey).join(',')})`
  }
}

// AND/OR ノードを組み立てる。空の被演算子 (null) を落とし、同一の部分式を
// 畳み、子が 1 つなら中身をそのまま返す (`(A)` → A、`A OR A` → A)。
function combine(
  op: 'and' | 'or',
  children: (SearchExpr | null)[],
): SearchExpr | null {
  const seen = new Set<string>()
  const unique: SearchExpr[] = []
  for (const child of children) {
    if (child === null) continue
    const key = exprKey(child)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(child)
  }
  if (unique.length === 0) return null
  if (unique.length === 1) return unique[0]
  return { op, children: unique }
}

// トークン列を再帰下降で AST へ。優先順位は NOT > AND (並置) > OR。
// 括弧は balanceParens 済みである前提。
function parseTokens(tokens: Token[]): SearchExpr | null {
  let pos = 0
  const peek = (): Token | undefined => tokens[pos]

  const parsePrimary = (): SearchExpr | null => {
    const token = peek()
    if (token === undefined) return null
    if (token.type === 'term') {
      pos++
      return { op: 'term', term: token.term }
    }
    if (token.type === 'lparen') {
      pos++
      const inner = parseOr()
      if (peek()?.type === 'rparen') pos++
      return inner
    }
    // `or` / `rparen` は上位が処理するのでここでは消費しない。
    return null
  }

  const parseUnary = (): SearchExpr | null => {
    let negated = false
    while (peek()?.type === 'not') {
      pos++
      negated = !negated // 二重否定は打ち消す
    }
    const operand = parsePrimary()
    if (operand === null) return null // 被演算子のない `!` は無視
    return negated ? { op: 'not', child: operand } : operand
  }

  const parseAnd = (): SearchExpr | null => {
    const children: (SearchExpr | null)[] = []
    while (pos < tokens.length) {
      const type = peek()!.type
      if (type === 'or' || type === 'rparen') break
      children.push(parseUnary())
    }
    return combine('and', children)
  }

  function parseOr(): SearchExpr | null {
    const children: (SearchExpr | null)[] = [parseAnd()]
    while (peek()?.type === 'or') {
      pos++
      children.push(parseAnd())
    }
    return combine('or', children)
  }

  return parseOr()
}

// keep が false を返した葉を落とした木を返す。空になったノードは combine が
// 畳み、何も残らなければ null。
//
// **`!` の被演算子が消えたら否定ごと落とす**のがこの関数の肝。残すと
// 「NOT (無条件)」= 全件除外に化け、絞ったつもりが 0 件になる。
// 葉を落とす操作はどれもこの落とし穴を踏むので、走査を 1 つに集約してある。
function pruneTerms(
  expr: SearchExpr,
  keep: (term: SearchTerm) => boolean,
): SearchExpr | null {
  switch (expr.op) {
    case 'term':
      return keep(expr.term) ? expr : null
    case 'not': {
      const child = pruneTerms(expr.child, keep)
      return child === null ? null : { op: 'not', child }
    }
    case 'and':
    case 'or':
      return combine(
        expr.op,
        expr.children.map((child) => pruneTerms(child, keep)),
      )
  }
}

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

// 葉 (検索語) の数を先頭から数えて上限で丸める (WHERE 肥大の安全弁)。
function capTerms(expr: SearchExpr, max: number): SearchExpr | null {
  let budget = max
  return pruneTerms(expr, () => budget-- > 0)
}

// 検索クエリを AST に解析する。絞り込みが何も残らなければ null。
export function parseSearchExpr(query: string): SearchExpr | null {
  const expr = parseTokens(balanceParens(tokenize(query)))
  return expr === null ? null : capTerms(expr, MAX_SEARCH_TERMS)
}

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
