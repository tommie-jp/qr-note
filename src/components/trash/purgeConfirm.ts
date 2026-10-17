// 永久削除の確認文 (docs/12-ゴミ箱計画.md §4)。行の「永久削除」ボタン
// (TrashList) と画像表示のタイルの ⋮ (TrashTileMenuProvider) が同じ文を出す。
//
// tileCount … 画像表示で、同じノートのタイルがこのページに何枚あるか。
// 複数なら「まとめて消える」と添える (docs/107 §9)。行では 1 のまま
//
// name はノートの呼び名 (lib/items/noteName.ts)。もとは「この番号は新しいノートに
// 再利用されます。シールも処分済みですか?」と添えていたが、id は UUID になって
// 再利用されなくなった (docs/107 §5)
export function purgeConfirmMessage(name: string, tileCount = 1): string {
  const tiles =
    tileCount > 1
      ? `このノートの ${tileCount} 枚のタイルがまとめて消えます。`
      : "";
  return `${name}を完全に削除します。${tiles}元に戻せません。よろしいですか?`;
}
