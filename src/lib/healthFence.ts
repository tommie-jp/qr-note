// ```health フェンスの設定を読む (DB 非依存の純関数。
// docs/83-健康管理フェンス計画.md §4)。
//
// 文法は ```matrix (matrixFence.ts) と同じ — **1 行目は必ず検索式**として読み、
// 2 行目以降を `キー=値` として読む。同じ見た目のフェンスが 2 通りの文法を
// 持たないようにするため、区切り (全角 ＝ を許す)・畳み方 (キーだけ NFKC)・
// 知らないキーはエラーにする作法まで揃えている。

import { editDistance } from './fenceLanguages'

// 期間の既定 (日)。BPNote の「1 か月」に当たる
export const DEFAULT_HEALTH_DAYS = 30

// 期間の上限 (日)。約 13 か月 = 1 年ぶんのノートを 1 枚のグラフで見渡せる長さ。
// 1 日 1 点なので、点の数もここで自然に頭打ちになる
export const MAX_HEALTH_DAYS = 400

export interface HealthSpec {
  // 対象を決める検索式 (検索窓と同じ文法)。空なら絞り込みなし
  query: string
  // 縦軸にする項目 (書かれたままの表示用)。
  // **null なら本文から拾う** — 記録がいちばん多い項目を選ぶ (計画 §4)
  item: string | null
  days: number
}

export type HealthParseResult = HealthSpec | { error: string }

// 項目名を照合するときの畳み方。表記ゆれのうち「打ち方の違い」だけを吸収する
// (全角/半角・大文字小文字・前後の空白)。
//
// matrixFence の normalizeCheckLabel と同じ 1 行だが、あちらから借りずに持つ。
// 畳む対象が「チェックの名前」と「測定項目の名前」で別物なので、片方の都合で
// 規則を変えたときにもう片方が黙って道連れになるほうが危ない
export function normalizeMeasureLabel(label: string): string {
  return label.normalize('NFKC').trim().toLowerCase()
}

// 打ち間違いへの助言だけに使う表。**受け付ける綴りではない** —
// 受け付けた綴りはノートに残ってやめられないので、増やさずに案内する
// (matrixFence の KEY_HINTS と同じ約束)
const KEY_HINTS: Record<string, string> = {
  項目: 'y',
  item: 'y',
  col: 'y',
  value: 'y',
  軸: 'y',
  縦軸: 'y',
  期間: 'days',
  日数: 'days',
  range: 'days',
  period: 'days',
  span: 'days',
}

const OPTION_KEYS = ['y', 'days'] as const
const MAX_KEY_EDIT_DISTANCE = 2

// 綴りの近さで助言してよいキーの長さ。**`y` を距離で測らない**のが要点で、
// 1 文字のキーは何とでも距離 2 以内になり、`dz=` のような無関係な打ち間違いに
// まで「y= のことですか?」と答えてしまう。1 文字のキーは KEY_HINTS だけで案内する
const MIN_KEY_LENGTH_FOR_DISTANCE = 3

function suggestKey(key: string): string | null {
  const hinted = KEY_HINTS[key]
  if (hinted !== undefined) {
    return hinted
  }
  for (const known of OPTION_KEYS) {
    if (known.length < MIN_KEY_LENGTH_FOR_DISTANCE) {
      continue
    }
    if (editDistance(key, known, MAX_KEY_EDIT_DISTANCE) <= MAX_KEY_EDIT_DISTANCE) {
      return known
    }
  }
  return null
}

function unknownKeyError(key: string): string {
  const suggestion = suggestKey(key)
  return suggestion === null
    ? `知らない設定「${key}」です`
    : `知らない設定「${key}」です。${suggestion}= のことですか?`
}

// キー=値 の区切り。全角の ＝ も区切りとして認める (matrixFence と同じ)
function separatorIndex(line: string): number {
  const half = line.indexOf('=')
  const full = line.indexOf('＝')
  if (half < 0) {
    return full
  }
  return full < 0 ? half : Math.min(half, full)
}

// 日数として読む。全角数字は畳んでから見る (`days=９０`)。
// **小数を切り捨てて通さない** — `days=30.5` を 30 として黙って受けると、
// 書いた人は自分の書き方が通ったと思い込む
function parseDaysValue(value: string): number | null {
  const folded = value.normalize('NFKC').trim()
  if (!/^\d+$/.test(folded)) {
    return null
  }
  const days = Number(folded)
  if (days < 1 || days > MAX_HEALTH_DAYS) {
    return null
  }
  return days
}

export function parseHealthFence(source: string): HealthParseResult {
  const lines = source.split(/\r?\n/)
  // 1 行目だけは正規化しない — 検索式の正規化 (NFKC) は tokenize が自分で
  // 行う作法なので、ここで先回りすると引用リテラルの中身まで畳む
  const query = (lines[0] ?? '').trim()

  let item: string | null = null
  let days: number | null = null

  for (const raw of lines.slice(1)) {
    const line = raw.trim()
    if (line === '') {
      continue
    }

    const eq = separatorIndex(line)
    if (eq <= 0) {
      return { error: `設定は「キー=値」の形で書きます: 「${line}」` }
    }
    // **畳むのはキーだけ。** 値は打ったまま持つ — 項目名は軸のラベルとして
    // 画面に出るので、本文に書いた綴りのままにする (照合が要るところで
    // normalizeMeasureLabel を通す)
    const key = line.slice(0, eq).normalize('NFKC').trim().toLowerCase()
    const value = line.slice(eq + 1).trim()

    if (key === 'y') {
      if (item !== null) {
        return { error: '設定「y」が 2 回書かれています' }
      }
      if (value === '') {
        return { error: '項目名が空です (y=体重 のように書きます)' }
      }
      item = value
      continue
    }

    if (key === 'days') {
      if (days !== null) {
        return { error: '設定「days」が 2 回書かれています' }
      }
      const parsed = parseDaysValue(value)
      if (parsed === null) {
        return {
          error: `日数「${value}」は 1〜${MAX_HEALTH_DAYS} の整数で書きます`,
        }
      }
      days = parsed
      continue
    }

    return { error: unknownKeyError(key) }
  }

  return { query, item, days: days ?? DEFAULT_HEALTH_DAYS }
}
