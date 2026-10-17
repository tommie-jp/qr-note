// 永久削除の確認文 (docs/12-ゴミ箱計画.md §4)。行の「永久削除」ボタン
// (TrashList) と画像表示のタイルの ⋮ (TrashTileMenuProvider) が同じ文を出す。
//
// tileCount … 画像表示で、同じノートのタイルがこのページに何枚あるか。
// 複数なら「まとめて消える」と添える (docs/107 §9)。行では 1 のまま
export function purgeConfirmMessage(itemNo: string, tileCount = 1): string {
  const tiles =
    tileCount > 1
      ? `このノートの ${tileCount} 枚のタイルがまとめて消えます。`
      : "";
  return `#${itemNo} を完全に削除します。${tiles}元に戻せず、この番号は新しいノートに再利用されます。シールも処分済みですか?`;
}
