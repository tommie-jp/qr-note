// 記録欄から本文へ 1 つの測定値を書き込む (DB 非依存の純関数。
// docs/83-健康管理フェンス計画.md §7)。
//
// **書いたものを自分で読み直せることを確かめてから書く。** 組み立てた
// トークンを parseMeasureToken に通し、同じ値として読めなければ書かずに
// 断る (null)。読めない行がノートに残るのがいちばん困る — 本人は記録した
// つもりで、グラフにだけ出てこない。
//
// **同じ日の他の項目を壊さない。** 行を組み直すのではなく、その項目の
// トークンだけを差し替える。`- 2026-08-14 体重=66.4 体温=36.5` の体温を
// 直しても体重は 1 文字も動かない (toggleTaskLine が 1 行だけ書き換えるのと
// 同じ作法)。

import { normalizeMeasureLabel } from './healthFence'
import {
  healthDataLines,
  isRecordDate,
  matchDataLine,
  parseMeasureToken,
} from './healthRecords'
import { joinLines, splitLines } from './memoLines'

export interface HealthEntry {
  date: string
  // 項目名 (書かれたままの綴り)
  item: string
  value: number
  // 単位 (無ければ空文字)
  unit: string
}

// 行頭の飾り (字下げ + 箇条書き記号)。新しい行を足すとき、いま書いてある
// 記録の書き方をそのまま真似るために取り出す
const LINE_PREFIX_RE = /^[ \t　]*(?:[-*+][ \t　]+)?/

// 項目名と単位の長さの上限。記録欄は誰でも叩ける POST の口 (actions.ts) の
// 先にあるので、本文へ書く文字列の長さはここで頭打ちにする。
// 32 文字は「収縮期血圧」のような名前が余裕で入る長さ
export const MAX_MEASURE_ITEM_LENGTH = 32
export const MAX_MEASURE_UNIT_LENGTH = 8

// トークン (空白で区切られたひとかたまり)
const TOKEN_RE = /[^\s　]+/g

// キーと値の区切り (healthRecords が読むのと同じ 2 種類)
const MEASURE_SEPARATOR = /[=＝]/

function tokenOf(entry: HealthEntry): string {
  return `${entry.item}=${entry.value}${entry.unit}`
}

// 値の部分だけの文字列 (`66.4kg`)。本文にある綴りの項目名を残して
// 差し替えるときに使う
function valueOf(entry: HealthEntry): string {
  return `${entry.value}${entry.unit}`
}

// 書いた行を読み直せるか。**組み立てた 1 行そのものを読む側に通す**のが要点。
//
// トークン 1 つだけを検めるのでは足りない。`体 重` のように空白を含む項目名は
// トークンとしては読めてしまうが、行に置いた瞬間に空白で切られて `重` という
// 別の項目になる。行ごと通せばこの手の食い違いは全部ここで落ちるし、
// 読む側の規則が変わっても検める側が自動で付いてくる
function isWritable(entry: HealthEntry): boolean {
  if (!isRecordDate(entry.date)) {
    return false
  }
  if (
    entry.item.length > MAX_MEASURE_ITEM_LENGTH ||
    entry.unit.length > MAX_MEASURE_UNIT_LENGTH
  ) {
    return false
  }
  const [read] = healthDataLines(`- ${entry.date} ${tokenOf(entry)}`)
  const measure = read?.measures[0]
  return (
    read?.date === entry.date &&
    read.measures.length === 1 &&
    measure?.label === entry.item &&
    measure.value === entry.value &&
    measure.unit === entry.unit
  )
}

// その日の行の中で、同じ項目のトークンを差し替える。無ければ行末に足す。
//
// **同じ項目が 1 行に 2 度書いてあれば、後ろのほうを直す。** 読む側
// (healthSeries) は文書順に上書きするので後ろが勝つ。前を直すと、保存は
// 成功しているのにグラフの値が動かない — 何度押しても直らない形になる。
function withMeasure(line: string, entry: HealthEntry): string {
  const matched = matchDataLine(line)
  if (matched === null) {
    return line
  }
  const key = normalizeMeasureLabel(entry.item)
  let hit: { start: number; token: string } | null = null
  for (const token of matched.rest.matchAll(TOKEN_RE)) {
    const measure = parseMeasureToken(token[0])
    if (measure === null || normalizeMeasureLabel(measure.label) !== key) {
      continue
    }
    hit = { start: matched.restStart + token.index, token: token[0] }
  }
  if (hit === null) {
    return `${line} ${tokenOf(entry)}`
  }
  // **項目名と区切りは本文の綴りを残し、値だけ差し替える**
  // (`ＢＭＩ＝22.1` を `bmi=22.5` に書き換えない)。頼まれたのは値を直す
  // ことであって、名前や記号を揃えることではない
  const separator = hit.token.search(MEASURE_SEPARATOR)
  return (
    line.slice(0, hit.start) +
    hit.token.slice(0, separator + 1) +
    valueOf(entry) +
    line.slice(hit.start + hit.token.length)
  )
}

// 記録を 1 つ書き込んだ本文を返す。書けない値なら null。
//
// 置き場所の決め方 (計画 §7):
//   1. その日付の行があれば、その行の中でその項目だけを差し替える
//      (同じ日付が 2 行あれば**後のほう** — 読むときの後勝ちと揃える)
//   2. 無ければ**最後の記録の直後**に 1 行足す。記録がまだ 1 つも無ければ
//      本文の末尾 (フェンスや文章の間に潜り込ませない)
export function recordMeasurement(
  memo: string,
  entry: HealthEntry,
): string | null {
  if (!isWritable(entry)) {
    return null
  }

  const lines = splitLines(memo)
  const dataLines = healthDataLines(memo)
  const sameDate = dataLines.filter((line) => line.date === entry.date)
  const target = sameDate[sameDate.length - 1]

  if (target !== undefined) {
    lines[target.line - 1] = withMeasure(lines[target.line - 1], entry)
    return joinLines(lines, memo)
  }

  const last = dataLines[dataLines.length - 1]
  const prefix =
    last === undefined
      ? '- '
      : (LINE_PREFIX_RE.exec(lines[last.line - 1])?.[0] ?? '- ')
  const newLine = `${prefix}${entry.date} ${tokenOf(entry)}`

  if (last !== undefined) {
    lines.splice(last.line, 0, newLine)
    return joinLines(lines, memo)
  }

  // 末尾の空行より前へ入れる (ノートの終わりの余白を増やし続けない)。
  // 本文が続いているときは空行を 1 つ挟む — 段落の続きの行として
  // 読まれると、箇条書きにならず記録の行にも見えない
  let at = lines.length
  while (at > 0 && lines[at - 1].trim() === '') {
    at--
  }
  lines.splice(at, 0, ...(at > 0 ? ['', newLine] : [newLine]))
  return joinLines(lines, memo)
}
