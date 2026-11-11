// 検索窓の＋で新しい予定を足す日 (docs/126 §1-17)。
// 選んだ日 (黄色のマス) → 見ている月が今月なら今日 → その月の 1 日
export function dayToAdd(selected: string | null, month: string, today: string): string {
  if (selected !== null) {
    return selected
  }
  return today.startsWith(month) ? today : `${month}-01`
}
