// マス目で選んでいる日の控え (docs/126 §1-17)。
//
// 選んだ日は CalendarView の state だが、それを読みたい検索窓の＋は core の部品で
// 木の外にある。押した瞬間に 1 度読むだけなので、購読の仕組みは持たない
let selected: string | null = null

export function setSelectedCalendarDay(day: string | null): void {
  selected = day
}

export function selectedCalendarDay(): string | null {
  return selected
}
