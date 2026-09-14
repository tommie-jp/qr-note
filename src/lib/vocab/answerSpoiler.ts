// 答え隠し `||答え||` の走査 (DB 非依存の純関数。docs/79-答え隠し計画.md)。
//
// 単語帳の 1 行 1 語を守るための行内記法。`:::details` はブロックなので
// 語ごとにリストが分断され、1 語 4 行になっていた (計画 §1)。
//
// **行内に収まる 1 つのテキストの中だけ**を見る。`||` の間に強調やリンクが
// 挟まっているものは記法として扱わない (文字のまま残る) — 単語帳の答えは
// 素の文字なので足りるし、跨いだ場合まで見ると閉じ忘れの解釈が難しくなる。

// 答えの中に `|` は書けない (表の記法と見分けが付かなくなる)。
// 改行も跨がない。空 (`||||`) は記法と見なさず文字のまま残す
const SPOILER_RE = /\|\|([^|\n]+)\|\|/g

export const ANSWER_SPOILER_CLASS = 'answer-spoiler'

// 閉じているときに出す印。押すと開く (開くと ▼ に変わる)
export const ANSWER_CLOSED_MARK = '▶'
export const ANSWER_OPEN_MARK = '▼'

export interface AnswerSpoilerMatch {
  // `||` を含む全体の開始位置と長さ (置換に使う)
  start: number
  length: number
  // `||` を除いた中身
  answer: string
}

// テキスト中の答え隠しを左から順に返す。
export function findAnswerSpoilers(text: string): AnswerSpoilerMatch[] {
  const matches: AnswerSpoilerMatch[] = []
  for (const m of text.matchAll(SPOILER_RE)) {
    matches.push({ start: m.index, length: m[0].length, answer: m[1] })
  }
  return matches
}

// 答えを丸ごと取り除く。一覧のプレビューと要約で使う — 隠した物が
// カードに出ていたら隠した意味がない (計画 §5)。
export function stripAnswerSpoilers(text: string): string {
  return text.replace(SPOILER_RE, '')
}

// 答え隠しを持つ本文か。ノートに「すべて表示」を出すかの判定に使う。
//
// **コードフェンスの中までは見分けない** (行単位の走査をしない安い判定)。
// 外した場合の症状は「押しても何も開かないボタンが出る」だけで、
// 隠した答えが漏れる向きには倒れない。
export function hasAnswerSpoiler(text: string): boolean {
  return findAnswerSpoilers(text).length > 0
}
