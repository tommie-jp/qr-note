// 健康記録を 1 本の折れ線に畳む (DB 非依存の純関数。
// docs/83-健康管理フェンス計画.md §5, §6)。
//
// **DB から集計せず、ノートの本文を受け取って畳む。** 純関数なので DB 無しで
// テストでき、オフライン (端末の写しも memo を持つ) でも同じ関数が同じ線を
// 描ける。進捗の表 (matrixTable.ts) と同じ役割分担。
//
// 「今日」を持ち込まないのもここの約束 — 期間は**いちばん新しい記録日**から
// 遡って切る (計画 §4)。サーバの時刻・タイムゾーンに依存しないので、
// テストに現在時刻が現れない。

import { normalizeMeasureLabel } from './healthFence'
import { healthDataLines, type HealthParseCache } from './healthRecords'

// 線を切る間隔 (日)。これより長く空いた区間は結ばない。
// 2 週間の空白を直線で結ぶと、測っていない期間を測ったように見せてしまう
export const HEALTH_GAP_DAYS = 7

// 縦軸の目盛りの本数の上限 (= 区間の数 + 1)。これを超えないきりのよい刻みを選ぶ
const MAX_AXIS_INTERVALS = 4

// データの上下に足す余白の割合。線が枠にぴったり付くと読みにくい
const AXIS_PADDING_RATIO = 0.05

// 1 日のミリ秒。日付を通し番号に直すのに使う
const MS_PER_DAY = 86400000

// 表 (searchItemHealth) から来る 1 行
export interface HealthSourceRow {
  itemNo: string
  memo: string
}

export interface HealthPoint {
  date: string
  // その日の値。血圧のような対の値は 2 つ入る (計画 §9)。
  // **日によって数が違いうる** (ある日は `118/76`、別の日は `118` だけ)
  values: number[]
  // 日付の通し番号 (グラフの横位置と、線を切る判定に使う)
  day: number
}

export interface HealthAxis {
  lo: number
  hi: number
  ticks: number[]
  // 目盛りの表示に使う小数の桁数
  decimals: number
}

export interface HealthSeries {
  // 縦軸にした項目 (表示用の綴り)。記録が 1 つも無ければ空文字
  item: string
  // 軸に添える単位 (無ければ空文字)
  unit: string
  // 日付の昇順。1 日 1 点
  points: HealthPoint[]
  // 線の本数 (= 値の数がいちばん多い点の値の数)。ふつうの項目は 1、
  // 血圧のような対の値なら 2 (計画 §9)
  lines: number
  // 期間の外なので描かなかった点の数。黙って切ると「これで全部」に読める
  omitted: number
  // 選ばなかった項目 (多い順)。`y=` で選べることを画面で案内するのに使う
  otherItems: string[]
  // 点が無ければ null
  axis: HealthAxis | null
}

// ISO の日付を通し番号にする。Date.UTC で組むのでタイムゾーンに依らない
function dayNumber(iso: string): number {
  const year = Number(iso.slice(0, 4))
  const month = Number(iso.slice(5, 7))
  const day = Number(iso.slice(8, 10))
  return Date.UTC(year, month - 1, day) / MS_PER_DAY
}

// 軸のラベル用に 月/日 へ畳む。ゼロ埋めしない (`8/14`)
export function formatMonthDay(iso: string): string {
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`
}

// 刻みの候補 (1 / 2 / 2.5 / 5 × 10ⁿ)。人が読める数はこの 4 種類で足りる
const STEP_MANTISSAS = [1, 2, 2.5, 5] as const

// 候補を試す回数の上限。範囲が壊れた値 (NaN など) で回り続けないための保険
const MAX_STEP_TRIES = 40

// 刻みの小数桁。候補は m × 10ⁿ なので、指数と 2.5 かどうかで決まる
// (Math.log10 から求めると 0.25 が 1 桁と出て、目盛りが 65.8 のように丸まる)
function decimalsOf(mantissa: number, exponent: number): number {
  const fraction = mantissa === 2.5 ? 1 : 0
  return Math.max(0, fraction - exponent)
}

// 浮動小数の誤差を落とす (331 × 0.2 が 66.20000000000002 にならないように)
function roundTo(value: number, decimals: number): number {
  return Number(value.toFixed(decimals))
}

// 縦軸を作る。
//
// **0 から始めない。** 体重の 66.4kg と 66.8kg は 0 起点の軸ではただの
// 平らな線になり、グラフを見る目的そのものが消える (計画 §6)。
// ただし**負に食い込ませない** — 0 以上のデータ (歩数など) で軸が
// マイナスまで伸びると、あり得ない範囲を眺めることになる。
export function buildAxis(min: number, max: number): HealthAxis {
  const span = max - min
  // 全部同じ値でも軸が潰れないよう、幅が無いときは値の 1% (それも 0 なら 0.5)
  const padding =
    span === 0
      ? Math.abs(min) * 0.01 || 0.5
      : span * AXIS_PADDING_RATIO
  const paddedLo = min >= 0 && min - padding < 0 ? 0 : min - padding
  const paddedHi = max + padding

  // きりのよい刻みを小さいほうから試し、**目盛りに合わせて外へ広げた後**の
  // 区間数が上限に収まる最初のものを採る。広げる前で数えると、外へ丸めた
  // ぶんで目盛りが 1 本増えて 6 本の軸になる
  const start = Math.floor(Math.log10(Math.max(paddedHi - paddedLo, Number.EPSILON) / MAX_AXIS_INTERVALS))
  for (let tried = 0; tried < MAX_STEP_TRIES; tried++) {
    const exponent = start + Math.floor(tried / STEP_MANTISSAS.length)
    const mantissa = STEP_MANTISSAS[tried % STEP_MANTISSAS.length]
    const step = mantissa * 10 ** exponent
    const from = Math.floor(paddedLo / step)
    const to = Math.ceil(paddedHi / step)
    if (to - from > MAX_AXIS_INTERVALS) {
      continue
    }
    const decimals = decimalsOf(mantissa, exponent)
    const ticks: number[] = []
    for (let index = from; index <= to; index++) {
      ticks.push(roundTo(index * step, decimals))
    }
    return {
      lo: ticks[0],
      hi: ticks[ticks.length - 1],
      ticks,
      decimals,
    }
  }
  // ここへは来ない (刻みを 10 倍し続ければ必ず収まる)。来たら素の範囲を返す
  return { lo: paddedLo, hi: paddedHi, ticks: [paddedLo, paddedHi], decimals: 1 }
}

// line 本目の線を、切れ目で区間に分ける。**点はどの区間にも 1 度だけ入る**
// (切れ目の点を両方に入れると、切ったはずの場所に短い線が残る)。
//
// その日にその値が書かれていない点は**線から外す**だけで、切れ目にはしない。
// 血圧を毎日、脈拍を時々しか書かない使い方で、脈拍の線が 1 点ずつに割れて
// しまうため — 間が空きすぎたかどうかは日数 (gapDays) だけで決める
export function splitSegments(
  points: readonly HealthPoint[],
  line = 0,
  gapDays: number = HEALTH_GAP_DAYS,
): HealthPoint[][] {
  const segments: HealthPoint[][] = []
  let current: HealthPoint[] = []
  for (const point of points) {
    if (point.values[line] === undefined) {
      continue
    }
    const previous = current[current.length - 1]
    if (previous !== undefined && point.day - previous.day > gapDays) {
      segments.push(current)
      current = []
    }
    current.push(point)
  }
  if (current.length > 0) {
    segments.push(current)
  }
  return segments
}

interface FoundItem {
  label: string
  count: number
  first: number
}

// 集めた記録を項目ごとに数える。鍵 = 照合用に畳んだ名前、
// 値 = 初出の綴り + 件数 + 初出の順 (matrixTable の deriveColumns と同じ形)
function countItems(records: readonly RawRecord[]): Map<string, FoundItem> {
  const found = new Map<string, FoundItem>()
  let order = 0
  for (const record of records) {
    const hit = found.get(record.key)
    if (hit === undefined) {
      found.set(record.key, { label: record.label, count: 1, first: order++ })
    } else {
      hit.count++
    }
  }
  return found
}

function sortedItems(found: Map<string, FoundItem>): [string, FoundItem][] {
  return [...found.entries()].sort(
    ([, a], [, b]) => b.count - a.count || a.first - b.first,
  )
}

interface RawRecord {
  date: string
  key: string
  label: string
  values: number[]
  unit: string
}

// すべてのノートの本文から記録を文書順に集める。
// 順が意味を持つ場面が 2 つある — 項目の初出順と、同じ日付の後勝ち
function collectRecords(
  rows: readonly HealthSourceRow[],
  cache: HealthParseCache,
): RawRecord[] {
  return rows.flatMap((row) =>
    healthDataLines(row.memo, cache).flatMap((line) =>
      line.measures.map((measure) => ({
        date: line.date,
        key: normalizeMeasureLabel(measure.label),
        label: measure.label,
        values: measure.values,
        unit: measure.unit,
      })),
    ),
  )
}

// 折れ線 1 本ぶんのデータを組む。
//
// item を渡さなければ**記録がいちばん多い項目**を選ぶ (計画 §4)。
// 渡した項目の記録が 1 つも無いときは空の系列を返す — エラーにはしない。
// 「その項目はまだ書いていない」は間違いではなく、他にどんな項目があるかを
// otherItems で示せば済む。
export function buildHealthSeries(
  rows: readonly HealthSourceRow[],
  item: string | null,
  days: number,
  // 本文の解析結果の控え。**グラフを複数枚描くときは呼び出し側が持ち回る** —
  // 「検索式は同じで y= だけ違う」(体重と体温を並べる) が典型の使い方で、
  // 渡さないと同じ 200 ノートを枚数ぶん解析し直すことになる
  // (matrixData が CheckParseCache を配るのと同じ形)
  cache: HealthParseCache = new Map(),
): HealthSeries {
  const records = collectRecords(rows, cache)
  const found = countItems(records)
  const ranked = sortedItems(found)

  const key = item === null ? ranked[0]?.[0] : normalizeMeasureLabel(item)
  const label = item ?? ranked[0]?.[1].label ?? ''
  const otherItems = ranked
    .filter(([itemKey]) => itemKey !== key)
    .map(([, entry]) => entry.label)

  if (key === undefined) {
    return {
      item: label,
      unit: '',
      points: [],
      lines: 0,
      omitted: 0,
      otherItems,
      axis: null,
    }
  }

  // 同じ日付は後に読んだほうを採る (計画 §3)。Map は最後の set が残る
  const byDate = new Map<string, RawRecord>()
  for (const record of records) {
    if (record.key === key) {
      byDate.set(record.date, record)
    }
  }
  const sorted = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))

  // 期間は「いちばん新しい記録」から遡って days 日 (その日を 1 日目に数える)
  const newest = sorted[sorted.length - 1]
  const cutoff =
    newest === undefined ? 0 : dayNumber(newest.date) - (days - 1)
  const kept = sorted.filter((record) => dayNumber(record.date) >= cutoff)

  const points = kept.map((record) => ({
    date: record.date,
    values: record.values,
    day: dayNumber(record.date),
  }))
  // 軸は**全部の線をまたいだ範囲**にする。血圧の上と下を別々の軸に置くと、
  // 同じ高さが違う値を指す 2 本の線が 1 枚に並ぶ
  const values = points.flatMap((point) => point.values)

  return {
    item: label,
    unit: kept.find((record) => record.unit !== '')?.unit ?? '',
    points,
    lines: Math.max(0, ...points.map((point) => point.values.length)),
    omitted: sorted.length - kept.length,
    otherItems,
    axis:
      values.length === 0
        ? null
        : buildAxis(Math.min(...values), Math.max(...values)),
  }
}
