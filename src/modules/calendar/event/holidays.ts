// 日本の国民の祝日・休日を計算する (docs/126 §1-9)。DB にも React にも触らない純関数。
//
// 祝日法の規則から出す (パッケージの表を持たない)。正しさは内閣府の CSV
// (2016〜2027 年) と突き合わせたテストで見る (holidays.test.ts)。
//   - 固定日・ハッピーマンデー・春分/秋分 (1980〜2099 年の近似式)
//   - 振替休日 (日曜の祝日の後の最初の平日。2007 年〜)
//   - 国民の休日 (祝日に挟まれた平日)
//   - 2019〜2021 年の特例 (即位・東京五輪の移動)
// 春分・秋分は前年 2 月の官報で決まる。近似式が外れる年が出たら特例に足す
import { addDays } from './eventTime'

export interface Holiday {
  // YYYY-MM-DD
  date: string
  name: string
}

// 規則を当てる年の範囲 (振替休日が今の形になった 2007 年〜近似式の 2099 年)
const FIRST_YEAR = 2007
const LAST_YEAR = 2099

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

// その月の第 n 月曜日
function nthMonday(y: number, m: number, n: number): string {
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
  const firstMonday = 1 + ((8 - firstWeekday) % 7)
  return ymd(y, m, firstMonday + (n - 1) * 7)
}

function equinoxDay(y: number, base: number): number {
  return Math.floor(base + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4))
}

// 特例で動いた・足された日 (年ごとに、その年の規則の結果を上書きする)
const SPECIAL: Record<number, { drop?: string[]; add?: Holiday[] }> = {
  2019: {
    add: [
      { date: '2019-05-01', name: '天皇の即位の日' },
      { date: '2019-10-22', name: '即位礼正殿の儀の行われる日' },
    ],
  },
  2020: {
    drop: ['海の日', 'スポーツの日', '山の日'],
    add: [
      { date: '2020-07-23', name: '海の日' },
      { date: '2020-07-24', name: 'スポーツの日' },
      { date: '2020-08-10', name: '山の日' },
    ],
  },
  2021: {
    drop: ['海の日', 'スポーツの日', '山の日'],
    add: [
      { date: '2021-07-22', name: '海の日' },
      { date: '2021-07-23', name: 'スポーツの日' },
      { date: '2021-08-08', name: '山の日' },
    ],
  },
}

// 祝日法の「国民の祝日」(振替休日・国民の休日を除く)
function nationalHolidays(y: number): Holiday[] {
  const list: Holiday[] = [
    { date: ymd(y, 1, 1), name: '元日' },
    { date: nthMonday(y, 1, 2), name: '成人の日' },
    { date: ymd(y, 2, 11), name: '建国記念の日' },
    { date: ymd(y, 3, equinoxDay(y, 20.8431)), name: '春分の日' },
    { date: ymd(y, 4, 29), name: '昭和の日' },
    { date: ymd(y, 5, 3), name: '憲法記念日' },
    { date: ymd(y, 5, 4), name: 'みどりの日' },
    { date: ymd(y, 5, 5), name: 'こどもの日' },
    { date: nthMonday(y, 7, 3), name: '海の日' },
    { date: nthMonday(y, 9, 3), name: '敬老の日' },
    { date: ymd(y, 9, equinoxDay(y, 23.2488)), name: '秋分の日' },
    { date: nthMonday(y, 10, 2), name: y >= 2020 ? 'スポーツの日' : '体育の日' },
    { date: ymd(y, 11, 3), name: '文化の日' },
    { date: ymd(y, 11, 23), name: '勤労感謝の日' },
  ]
  if (y >= 2016) {
    list.push({ date: ymd(y, 8, 11), name: '山の日' })
  }
  // 天皇誕生日: 平成は 12/23、令和は 2/23 (2019 年は無い)
  if (y <= 2018) {
    list.push({ date: ymd(y, 12, 23), name: '天皇誕生日' })
  } else if (y >= 2020) {
    list.push({ date: ymd(y, 2, 23), name: '天皇誕生日' })
  }
  const special = SPECIAL[y]
  const kept = list.filter((h) => !special?.drop?.includes(h.name))
  return [...kept, ...(special?.add ?? [])]
}

const isSunday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() === 0

function holidaysOfYear(y: number): Map<string, string> {
  const days = new Map(nationalHolidays(y).map((h) => [h.date, h.name]))
  const national = [...days.keys()].sort()
  // 国民の休日: 前後の日が祝日の平日 (祝日・日曜でない日)
  for (const date of national) {
    const between = addDays(date, 1)
    if (days.has(addDays(between, 1)) && !days.has(between) && !isSunday(between)) {
      days.set(between, '国民の休日')
    }
  }
  // 振替休日: 日曜の祝日の後の、最初の祝日でない日
  for (const date of national) {
    if (!isSunday(date)) {
      continue
    }
    let next = addDays(date, 1)
    while (days.has(next)) {
      next = addDays(next, 1)
    }
    days.set(next, '振替休日')
  }
  return days
}

const cache = new Map<number, Map<string, string>>()

function yearTable(y: number): Map<string, string> {
  if (y < FIRST_YEAR || y > LAST_YEAR) {
    return new Map()
  }
  let table = cache.get(y)
  if (table === undefined) {
    table = holidaysOfYear(y)
    cache.set(y, table)
  }
  return table
}

// その日の祝日・休日の名前。祝日でなければ null
export function holidayName(date: string): string | null {
  return yearTable(Number(date.slice(0, 4))).get(date) ?? null
}

// [from, to) の祝日・休日を日付順に
export function holidaysBetween(from: string, to: string): Holiday[] {
  const out: Holiday[] = []
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
    for (const [date, name] of yearTable(y)) {
      if (date >= from && date < to) {
        out.push({ date, name })
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}
