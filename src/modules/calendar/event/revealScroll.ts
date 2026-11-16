// 「今日」の週をマス目の見える範囲の一番上へ送る (docs/126 §1-39)。
// 見える範囲の上端は、器の上端に貼り付いた見出し行 (年月・曜日) の下端。
// 週の上端をそこへ合わせると、今日のマスと、その先の日が最も多く見える。
// 最後の週は器の底より下へは送れないので、ブラウザが送れる所で止まる
export function weekTopScrollTop({
  scrollTop,
  rowTop,
  viewTop,
}: {
  // 器のいまの送り位置
  scrollTop: number;
  // 週 (今日のマス) の上端。画面の座標
  rowTop: number;
  // 見える範囲の上端 (貼り付いた見出し行の下端)。画面の座標
  viewTop: number;
}): number {
  return Math.max(0, Math.round(scrollTop + rowTop - viewTop));
}
