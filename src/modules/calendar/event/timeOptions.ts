// 日の一覧の時刻のパネルの選択肢 (docs/126 §1-14)。DB にも React にも触らない純関数。
// iPhone の <input type="time"> は step を守らないので、15 分刻みは選択欄で出す
const STEP_MINUTES = 15
const DAY_MINUTES = 24 * 60

const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
const fromMinutes = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

// 00:00〜23:45 の 15 分刻み。刻みに乗らないいまの値 (手で書いた 10:10 など) も
// 入れて並べる — 選んでいる値が欄に無いと、開いただけで別の時刻に見える
export function quarterHours(current?: string | null): string[] {
  const list = Array.from({ length: DAY_MINUTES / STEP_MINUTES }, (_, i) => fromMinutes(i * STEP_MINUTES))
  if (current != null && !list.includes(current)) {
    list.push(current)
    list.sort()
  }
  return list
}

export interface TimeRange {
  start: string
  // null なら開始から 1 時間
  end: string | null
}

// 開始を動かす。終わりがあれば長さを保って一緒に動かし、日をまたぐなら外す
export function moveStart(range: TimeRange, start: string): TimeRange {
  if (range.end === null) {
    return { start, end: null }
  }
  const end = toMinutes(start) + toMinutes(range.end) - toMinutes(range.start)
  return { start, end: end < DAY_MINUTES ? fromMinutes(end) : null }
}
