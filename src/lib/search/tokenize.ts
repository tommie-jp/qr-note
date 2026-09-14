// 検索窓の字句解析 (search/ の 1 段目)。入力文字列をトークン列へ分解する。
// 引用・全角の演算子・`#タグ`・`is:` の昇格はすべてこの層で決まり、
// 後段のパーサ (parse.ts) は種別の付いたトークンだけを見る。
// 文法の全体像は parse.ts 冒頭を参照。

import { normalizeTag, parseTagToken } from '@/lib/markdown/tags/tags'
import { UNTAGGED_TOKEN, type SearchTerm } from './types'

// 引用されていない単独語がこれ (全半角・大小を吸収して比較) のとき OR 演算子。
const OR_KEYWORD = 'or'
export const QUOTE = '"'
// 演算子はすべて全角も半角と同一視する (全角スペース・`＃` の扱いと揃える。
// 日本語キーボードからの入力ゆれの吸収。docs/16 §2)。
const PIPE_CHARS = '|｜'
const NOT_CHARS = '!！'
const LPAREN_CHARS = '(（'
const RPAREN_CHARS = ')）'

// `is:` 系の絞り込み語の接頭辞 (`is:todo` / `is:done` / `is:untagged`)。
// 全角 (`ＩＳ：`) も NFKC で畳まれてここに一致する
const IS_PREFIX = 'is:'

function isSpace(ch: string): boolean {
  return /[\s　]/.test(ch)
}

// `is:` 系の語なら対応する検索語を、そうでなければ null を返す。
// **知らない値 (`is:foo`) は null に落とす** — 例外にも 0 件にもせず、
// ただの語として全文検索へ回す。壊れた入力は「それらしく」解釈する流儀
// (未閉じ引用と同じ)。本文に is:foo と書いたノートが出るほうが説明できる。
// `is:` の値を増やすときはここへ足す (分岐を tokenFor に散らさない)
function parseIsToken(token: string): SearchTerm | null {
  const normalized = normalizeTag(token)
  if (!normalized.startsWith(IS_PREFIX)) {
    return null
  }
  if (normalized === UNTAGGED_TOKEN) {
    return { kind: 'untagged' }
  }
  const value = normalized.slice(IS_PREFIX.length)
  return value === 'todo' || value === 'done'
    ? { kind: 'task', value }
    : null
}

export type Token =
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
  const isTerm = parseIsToken(buf)
  if (isTerm !== null) {
    return { type: 'term', term: isTerm }
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
export function tokenize(query: string): Token[] {
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
