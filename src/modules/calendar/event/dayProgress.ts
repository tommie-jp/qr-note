// 月のマスの日付の右に出す、その日の予定の進み具合 (docs/126 §1-21)。
// すべて済みなら ✓、済みでない予定があれば「残n」、予定が無ければ何も出さない。
// 複数日の予定は、掛かっている日のどれでも 1 件と数える (eventsByDay の並びのまま)
export type DayProgress = { kind: 'done' } | { kind: 'left'; count: number }

export function dayProgress(events: readonly { done?: boolean }[]): DayProgress | null {
  if (events.length === 0) {
    return null
  }
  const left = events.filter((event) => event.done !== true).length
  return left === 0 ? { kind: 'done' } : { kind: 'left', count: left }
}
