// 単語帳の答え (`||答え||` の中身) を、発音ボタンを差し込める形に分ける純関数
// (docs/81-単語TTS発音計画.md)。DB もブラウザも要らないので、読み上げ本体
// (ttsSpeech.ts) とは別に置いてテストしやすくする。
//
// 想定する書き方は本番 #1128「英単語 10 語」の形:
//
//   - [x] concise [🔊](…) ||/kənˈsaɪs/ 簡潔な、要領を得た His answer was concise and clear.||
//                          └ ipa ────┘ └ 訳 ─────┘ └ example ──────────────┘
//
// **記法は増やさない。** 既に書いてあるノートがそのまま鳴るのが要件なので、
// 目印は「答えが発音記号で始まること」だけにする。それ以外の `||答え||`
// (電験ノートなど) は素の文字のまま出す — 迷ったらボタンを出さない側に倒す。

// 答えの先頭の発音記号 `/kənˈsaɪs/`。これが無ければ単語帳とは見なさない。
// 中に `/` は書けない (閉じが判らなくなる) し、行も跨がない
const IPA_RE = /^\s*\/[^/\n]+\//

// 末尾の英文。`.` `!` `?` で終わり、**大文字で始まる**並び。
//
// **発音記号を取り除いた後の文字列に当てる**こと。発音記号にも ASCII 文字が
// 混ざる (`/ˈmɪtɪɡeɪt/` の m・t・e) ので、答え全体に当てると解釈が揺れる。
//
// 文字クラスに `/` を入れないのも同じ理由 — 入れると発音記号ごと飲み込む。
//
// **大文字始まりに限るのが要点。** 小文字も許すと、訳に混ざった英語
// (`再開する(resume) He will resume work tomorrow.`) の途中から例文が始まって
// しまい、`(` が画面に取り残されて `)` が読み上げられる。英文は大文字で
// 始まるので、これで訳の側との境目が決まる
const EXAMPLE_RE = /[A-Z][A-Za-z0-9 ,.'’"“”:;!?()\-–—]*[.!?]\s*$/

// 訳に混ざった英語 1 語 (`reassemble.`) を例文と間違えないための下限。
// 例文なら必ず 2 語以上ある
const TWO_WORDS_RE = /[A-Za-z]\s+[A-Za-z]/

// 答えの直前にある見出し語。単語帳の 1 行は
// `- [x] concise [🔊](…) ||…||` なので、`||` より前の文字の**末尾**を取る。
//
// 4 語までに区切るのは、英語だけで書かれた行 (`||` の前が文になっている等) で
// 文まるごとを「単語」として読み上げないため
const HEADWORD_RE = /[A-Za-z][A-Za-z'’-]*(?: [A-Za-z'’-]+){0,3}\s*$/

export interface VocabAnswer {
  // 先頭の発音記号 (前後の空白を落としたもの)。表示には head を使う
  ipa: string
  // 例文の直前までの原文 (発音記号と訳)。**そのまま描くこと** —
  // head + example が元の答えに戻るよう切ってある
  head: string
  // 末尾の英文。無ければ null
  example: string | null
}

// 答えを「発音記号 + 訳」と「例文」に切る。単語帳の形でなければ null。
export function parseVocabAnswer(text: string): VocabAnswer | null {
  const ipaMatch = IPA_RE.exec(text)
  if (ipaMatch === null) {
    return null
  }
  const ipa = ipaMatch[0].trim()
  const rest = text.slice(ipaMatch[0].length)
  const exampleMatch = EXAMPLE_RE.exec(rest)
  if (exampleMatch === null || !TWO_WORDS_RE.test(exampleMatch[0])) {
    return { ipa, head: text, example: null }
  }
  const start = ipaMatch[0].length + exampleMatch.index
  return { ipa, head: text.slice(0, start), example: text.slice(start) }
}

// 答えの直前の文字列から見出し語を取る。取れなければ null (ボタンを出さない)。
export function trailingHeadword(text: string): string | null {
  const match = HEADWORD_RE.exec(text)
  return match === null ? null : match[0].trimEnd()
}
