import { weekTopScrollTop } from "../event/revealScroll";

// 送る器 (検索結果の一覧の器)。カレンダーは 1・2・3 ペインのどれでもこの中で送る
// (globals.css の [data-results-view] の積み方)
const SCROLLER = "[data-results-scroll]";
// 器の上端に貼り付く見出し行 (年月の行 + 曜日の行。CalendarView)
const HEAD = "[data-calendar-head]";

// 動きを減らす設定の端末では、なめらかに送らずその場で飛ぶ
function preferredBehavior(smooth: boolean): ScrollBehavior {
  if (!smooth || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return "instant";
  }
  return "smooth";
}

// day のマスの週を見える範囲の一番上へ送る (docs/126 §1-39)。
// マスがまだ無い (別の月を見ている・URL の月の書き換えが追いついていない) ときは
// false を返し、呼び手は月が替わってからやり直す
export function revealDayWeek(root: HTMLElement, day: string, smooth: boolean): boolean {
  const cell = root.querySelector<HTMLElement>(`[data-day="${day}"]`);
  const scroller = root.closest<HTMLElement>(SCROLLER);
  const head = root.querySelector<HTMLElement>(HEAD);
  if (cell === null || scroller === null || head === null) {
    return false;
  }
  // 見出し行が貼り付いたときの下端。まだ貼り付いていない (器の先頭にいる) ときも
  // 送った後の位置で測る — 器の上端 + 枠 + 見出し行の高さ
  const viewTop = scroller.getBoundingClientRect().top + scroller.clientTop + head.offsetHeight;
  const top = weekTopScrollTop({
    scrollTop: scroller.scrollTop,
    rowTop: cell.getBoundingClientRect().top,
    viewTop,
  });
  scroller.scrollTo({ top, behavior: preferredBehavior(smooth) });
  return true;
}
