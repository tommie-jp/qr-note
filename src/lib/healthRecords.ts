// 本文から健康記録のデータ行を読む (DB 非依存の純関数。
// docs/83-健康管理フェンス計画.md §3)。
//
// データ行はこの形。**行頭 (箇条書き記号があればその後) が ISO の日付**の行
// だけを記録とみなし、続く `キー=値` を測定値として読む。
//
//   - 2026-08-14 体重=66.4 体温=36.5
//
// 行番号 (1 始まり) も返す。読むだけなら要らないが、記録欄からの追記
// (healthEdit.ts) が「その日の行」を書き換えるのに使う — **読む側と書く側で
// 同じ物差しを使う**ためにここで一緒に返す。
//
// **コードの中かどうかはパーサに聞く** (taskCheckbox.ts と同じ作法)。
// 記号を数える自前の走査では、番号付きリストの中のフェンス (CommonMark では
// 4 字下げが正しい書き方) を見落とす。見落とすと記法の説明を書いたノートの
// 用例が記録として読まれ、しかも**記録欄がその説明文の数字を書き換える**
// (書く側も同じこの関数で行を探すため)。

import type { Code, Root } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import { splitLines } from './memoLines'

// 1 つの測定値。label は書かれたままの綴り (照合は normalizeMeasureLabel を通す)、
// unit は数値の後ろに書かれた単位 (`66.4kg` の `kg`。無ければ空文字)。
//
// **値は配列**。血圧のように対で書く値 (`118/76`) を 1 つの項目として持つため
// (計画 §9)。ふつうの項目は要素 1 つ
export interface Measure {
  label: string
  values: number[]
  unit: string
}

export interface HealthDataLine {
  // 本文の何行目か (1 始まり)
  line: number
  date: string
  // 数値として読めた測定値だけ。日付だけの行なら空
  measures: Measure[]
}

// 行頭の日付。箇条書き記号 (- * +) と字下げは許し、**日付の直後は空白か行末**に
// 限る。`2026-08-14の記録` のような散文を記録として読まないため
const DATA_LINE_RE = /^[ \t　]*(?:[-*+][ \t　]+)?(\d{4}-\d{2}-\d{2})(?:[ \t　]+(.*))?$/

// トークンの区切り (半角/全角の空白)。props.ts の TOKEN_SEPARATOR と揃える
const TOKEN_SEPARATOR = /[\s　]+/

// キーと値の区切り。全角の ＝ も認める (healthFence.ts と同じ約束)
const MEASURE_SEPARATOR = /[=＝]/

// 値の先頭にある数値。全角の数字・小数点・符号も受ける。
// **NFKC で畳んでから読まない**のが要点で、畳むと単位まで書き換わる
// (`℃` は NFKC で `°C` の 2 文字になる)。単位は書いたまま画面に出したい
const NUMBER_RE = /^([+\-＋－−]?[0-9０-９]+(?:[.．][0-9０-９]+)?)(.*)$/u

// 数値の後ろに残ってよいもの = 単位。**数字と空白と区切りを含まないこと**。
// これが `120～200` (範囲) を弾く境目になる — 数値に畳めない値を
// 「120 に ～200 という単位」として黙って線に載せるとグラフが嘘になる
const UNIT_RE = /^[^0-9０-９\s　/／]*$/u

// 値の中の区切り (血圧の `118/76`)。全角の ／ も認める
const VALUE_SEPARATOR = /[/／]/

// 1 つの項目に書ける値の数。血圧は 2 つ、機種によっては脈拍まで並べて 3 つ。
// **上限を持つのは、区切りの多い文字列を黙って何本もの線にしないため**
export const MAX_MEASURE_VALUES = 3

// 解析は毎回同じ構成なので使い回す (taskCheckbox.ts の MEMO_PARSER と同じ)。
// gfm を入れるのは、表やタスクリストの中の行位置を本文と揃えるため
const MEMO_PARSER = unified().use(remarkParse).use(remarkGfm).freeze()

// コードが占める行 (1 始まり) の集合。フェンスも字下げコードブロックも
// `code` ノードなので、記号を自分で数えるより漏れがない
function codeLines(memo: string): Set<number> {
  const tree = MEMO_PARSER.parse(memo) as Root
  const lines = new Set<number>()
  visit(tree, 'code', (node: Code) => {
    const position = node.position
    if (position === undefined) {
      return
    }
    for (let line = position.start.line; line <= position.end.line; line++) {
      lines.add(line)
    }
  })
  return lines
}

// 本文の解析結果の控え。同じノートの本文を、グラフの枚数だけ解析し直さない
// ため呼び出し側が持ち回る (matrixTable.ts の CheckParseCache と同じ形)
export type HealthParseCache = Map<string, readonly HealthDataLine[]>

// 記録として書ける日付か (ISO の形 + 暦にある日)。
// 記録欄から来た日付を書く前に検めるのにも使う (healthEdit.ts)
export function isRecordDate(text: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && isRealDate(text)
}

// 暦にある日付か。2026-02-30 のような行は記録として読まない
function isRealDate(iso: string): boolean {
  const year = Number(iso.slice(0, 4))
  const month = Number(iso.slice(5, 7))
  const day = Number(iso.slice(8, 10))
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

// 1 行を「日付 + その後ろ」に割る。読めなければ null。
//
// **読む側 (healthDataLines) と書く側 (healthEdit) が同じ物差しを使う**ための
// 関数。書く側は行の中の位置が要るので、後ろの部分の開始位置も返す
// (rest は行末までの捕獲なので、行の末尾から数えれば位置が判る)
export function matchDataLine(
  text: string,
): { date: string; rest: string; restStart: number } | null {
  const matched = DATA_LINE_RE.exec(text)
  if (matched === null) {
    return null
  }
  const [, date, rest = ''] = matched
  if (!isRealDate(date)) {
    return null
  }
  return { date, rest, restStart: text.length - rest.length }
}

// `体重=66.4kg` / `血圧=118/76mmHg` を 1 つの測定値にする。読めなければ null。
//
// **区切りの前の値には単位を許さない。** `118/76mmHg` の単位は末尾に 1 つで、
// 途中に文字が挟まる `118/上76` のような書き方は、読み違えるくらいなら
// 受けないほうがよい (数値に畳めない値を線にしない、という §3 の判断と同じ)
export function parseMeasureToken(token: string): Measure | null {
  const sep = token.search(MEASURE_SEPARATOR)
  if (sep <= 0) {
    return null
  }
  const label = token.slice(0, sep)
  const parts = token.slice(sep + 1).split(VALUE_SEPARATOR)
  if (parts.length > MAX_MEASURE_VALUES) {
    return null
  }

  const values: number[] = []
  let unit = ''
  for (const [index, part] of parts.entries()) {
    const matched = NUMBER_RE.exec(part)
    if (matched === null) {
      return null
    }
    const [, numberPart, rest] = matched
    // 単位を書けるのは最後の値の後ろだけ
    if (rest !== '' && (index < parts.length - 1 || !UNIT_RE.test(rest))) {
      return null
    }
    // 数値だけは畳んでから読む (全角の `６６.４` を受けるため)
    const value = Number(numberPart.normalize('NFKC'))
    if (!Number.isFinite(value)) {
      return null
    }
    values.push(value)
    unit = index === parts.length - 1 ? rest : unit
  }

  return { label, values, unit }
}

// 本文のデータ行を文書順に返す。
//
// **コードの中は読まない。** 記法の説明を書いたノートの用例が記録として
// 混ざると、グラフに身に覚えのない点が出る (プロパティが stripCode を
// 通すのと同じ判断)。閉じ忘れたフェンスの中も読まない — 書きかけの本文で、
// まだ本文になっていないため (remark も EOF までを code と読む)。
//
// cache … 同じ本文を何度も解析しないための控え。1 回の描画でグラフを
// 複数枚作るとき、対象のノートは全部同じ (呼び出し側が持ち回る)
export function healthDataLines(
  memo: string,
  cache?: HealthParseCache,
): readonly HealthDataLine[] {
  const cached = cache?.get(memo)
  if (cached !== undefined) {
    return cached
  }
  const lines: HealthDataLine[] = []
  const inCode = codeLines(memo)

  splitLines(memo).forEach((text, index) => {
    if (inCode.has(index + 1)) {
      return
    }
    const matched = matchDataLine(text)
    if (matched === null) {
      return
    }
    const { date, rest } = matched
    const measures = rest
      .split(TOKEN_SEPARATOR)
      .flatMap((token) => {
        const measure = parseMeasureToken(token)
        return measure === null ? [] : [measure]
      })
    lines.push({ line: index + 1, date, measures })
  })

  cache?.set(memo, lines)
  return lines
}
