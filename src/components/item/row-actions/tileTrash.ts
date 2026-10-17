// 画像モードのタイルからゴミ箱へ入れるときの確認文 (docs/107-行メニュー計画.md §7)。
//
// 小・中・大の行と違ってここだけ確認する。タイルは画像 1 枚ごとの見た目で、
// 「この画像を消す」と読まれやすい。実際にはノートごとゴミ箱へ入り、同じ
// ノートの他のタイルもまとめて一覧から消える。
// 複数あるときだけ枚数を言う — 1 枚なら「まとめて」の驚きは無い
export function tileTrashConfirmMessage(name: string, tileCount: number): string {
  const head = `${name}をノートごとゴミ箱へ移動します。`;
  const tiles =
    tileCount > 1
      ? `このノートの ${tileCount} 枚のタイルがまとめて一覧から消えます。`
      : "";
  return `${head}${tiles}\nゴミ箱から戻せます。`;
}
