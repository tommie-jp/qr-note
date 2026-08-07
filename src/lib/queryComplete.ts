// 検索窓の補完でタグ (tagComplete.ts) とキーワード (keywordComplete.ts) が
// 共通に使う部品 (docs/59-検索候補計画.md §5)。
//
// 2 つの補完は「どこからどこまでが打ちかけのトークンか」の判定だけが違い、
//   - 語の境界がどこか
//   - 引用符の内側にいるか (リテラル検索なので補完しない)
//   - 範囲を置き換えてキャレットをどこへ送るか
// は同じなので、ここに置いて両方から使う。

// 置き換える範囲 (入力文字列のインデックス)。
export interface CompleteRange {
  start: number
  end: number
}

export interface Completion {
  query: string
  cursor: number
}

// 直前がここなら新しいトークンの先頭とみなす。
// 境界の集合は search.ts の tokenize がトークンを切る位置と揃える:
// 空白と演算子 (`|` `!` `(` `)`、全角も) の直後は新しいトークンの先頭。
// 揃えないと `(!#np` や `!is:todo` と打った時点で補完が止まる。
export function isTokenBoundary(ch: string | undefined): boolean {
  return ch === undefined || /[\s　|｜!！()（）]/.test(ch)
}

// 引用符の内側 (`"#t` を打っている最中) かどうか。中では補完しない —
// 引用符はリテラル検索の指定で、`"is:todo"` は語そのものを探す意味になる。
export function insideQuote(query: string, cursor: number): boolean {
  let count = 0
  for (let i = 0; i < cursor; i++) {
    if (query[i] === '"') count++
  }
  return count % 2 === 1
}

// range を insert で置き換え、挿入直後のキャレット位置と一緒に返す。
// addSpace 時は末尾へスペースを補って次の語に移りやすくする
// (直後が既に空白なら足さない。全角空白も空白として数える)。
export function replaceRange(
  query: string,
  range: CompleteRange,
  insert: string,
  opts: { addSpace?: boolean } = {},
): Completion {
  const before = query.slice(0, range.start)
  const after = query.slice(range.end)
  const text = opts.addSpace && !/^[\s　]/.test(after) ? `${insert} ` : insert
  return { query: before + text + after, cursor: (before + text).length }
}
