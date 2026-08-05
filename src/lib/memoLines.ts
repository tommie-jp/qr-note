// メモ本文を行単位で書き換えるときの共通の作法 (DB 非依存の純関数)。
//
// 改行コードを保つのが要点。Ver1 由来のメモには CRLF のものがあり、素朴に
// `split('\n')` / `join('\n')` すると LF 混在に壊れる。読むときは両方受け、
// 書くときは元の本文が使っていたほうに揃える。

// 本文が使っている改行コード。\r\n を含むなら CRLF、それ以外は LF
export function newlineOf(memo: string): string {
  return memo.includes('\r\n') ? '\r\n' : '\n'
}

// 行に分ける (CRLF / LF のどちらでも切る)
export function splitLines(memo: string): string[] {
  return memo.split(/\r?\n/)
}

// 行をつなぎ直す。改行コードは元の本文 (source) に合わせる
export function joinLines(lines: string[], source: string): string {
  return lines.join(newlineOf(source))
}
