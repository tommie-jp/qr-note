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

import { splitLines } from './memoLines'

// 1 つの測定値。label は書かれたままの綴り (照合は normalizeMeasureLabel を通す)、
// unit は数値の後ろに書かれた単位 (`66.4kg` の `kg`。無ければ空文字)
export interface Measure {
  label: string
  value: number
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

// 数値の後ろに残ってよいもの = 単位。**数字と空白を含まないこと**。
// これが `118/76` (血圧) や `120～200` (範囲) を弾く境目になる — 数値 1 つに
// 畳めない値を「118 に /76 という単位」として黙って線に載せるとグラフが嘘になる
const UNIT_RE = /^[^0-9０-９\s　]*$/u

// フェンスの開始・終了行 (``` または ~~~)
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/

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

// `体重=66.4kg` を 1 つの測定値にする。読めなければ null
export function parseMeasureToken(token: string): Measure | null {
  const sep = token.search(MEASURE_SEPARATOR)
  if (sep <= 0) {
    return null
  }
  const label = token.slice(0, sep)
  const rest = token.slice(sep + 1)
  const matched = NUMBER_RE.exec(rest)
  if (matched === null) {
    return null
  }
  const [, numberPart, unit] = matched
  if (!UNIT_RE.test(unit)) {
    return null
  }
  // 数値だけは畳んでから読む (全角の `６６.４` を受けるため)
  const value = Number(numberPart.normalize('NFKC'))
  if (!Number.isFinite(value)) {
    return null
  }
  return { label, value, unit }
}

// 本文のデータ行を文書順に返す。
//
// **コードフェンスの中は読まない。** 記法の説明を書いたノートの用例が
// 記録として混ざると、グラフに身に覚えのない点が出る (プロパティが
// stripCode を通すのと同じ判断)。閉じ忘れたフェンスの中も読まない —
// 書きかけの本文で、まだ本文になっていないため
export function healthDataLines(memo: string): HealthDataLine[] {
  const lines: HealthDataLine[] = []
  // 開いているフェンスの記号 (` か ~)。null なら本文の中
  let fence: string | null = null

  splitLines(memo).forEach((text, index) => {
    const fenceMark = FENCE_RE.exec(text)
    if (fence === null) {
      if (fenceMark !== null) {
        fence = fenceMark[1][0]
        return
      }
    } else {
      if (fenceMark !== null && fenceMark[1][0] === fence) {
        fence = null
      }
      return
    }

    const matched = DATA_LINE_RE.exec(text)
    if (matched === null) {
      return
    }
    const [, date, rest] = matched
    if (!isRealDate(date)) {
      return
    }
    const measures = (rest ?? '')
      .split(TOKEN_SEPARATOR)
      .flatMap((token) => {
        const measure = parseMeasureToken(token)
        return measure === null ? [] : [measure]
      })
    lines.push({ line: index + 1, date, measures })
  })

  return lines
}
