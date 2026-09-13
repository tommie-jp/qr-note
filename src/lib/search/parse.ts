// 全文検索の検索語ユーティリティ (search/ の 2 段目、構文解析)。
// pgroonga への SQL 組み立ては items/where.ts が行い、search/ では
// ユーザー入力の解析だけを純関数として扱う (DB 非依存でテストしやすくするため)。
// 字句解析は tokenize.ts、解析済みの式を読む・書き換える道具は rewrite.ts。
//
// 検索窓の文法 (詳細は docs/05-全文検索の使い方.md / docs/16-検索の論理演算.md)。
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
// items/where.ts がパラメータとして渡す (構文エラー/エスケープ漏れを避ける)。

import { tokenize, type Token } from './tokenize'
import { MAX_SEARCH_TERMS, type SearchExpr, type SearchTerm } from './types'

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
      // untagged は値を持たない語。kind だけで一意になる
      return expr.term.kind === 'untagged'
        ? 'untagged'
        : `${expr.term.kind}:${expr.term.value}`
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
// 葉を落とす操作はどれもこの落とし穴を踏むので、走査を 1 つに集約してある
// (語数の丸め capTerms と、rewrite.ts の stripTaskTerms が共有する)。
export function pruneTerms(
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
