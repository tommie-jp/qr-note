// ノートのペインが「いま出している」と一覧へ知らせる番号 (docs/86 §4-4)。
// 一覧の行・画像タイルのハイライトと、先頭ノート (AutoNotePane) を引っ込める
// 判定がこれを見る。
//
// **出していない間は null** — 閉じたのに行だけ選ばれたまま、にしない。
//
// **読み込み中 (loading.tsx の器。itemId 無し) は URL の番号を使う**
// (docs/86 §4-18)。null を流すと「横取りのノートが無い」と読まれ、本物が
// 届くまでの間に先頭のノートが器の裏で生き返って画像を読み直していた。
// 遷移は URL が先に変わるので、押したノートの番号はここで既に判る。
// 旧番号 (/item/1003) のときは行の印と合わないだけで害はない。
// 自動で選んだ側 (auto) は URL と無関係なので使わない
export function shownPaneItemId({
  visible,
  itemId,
  source,
  pathItemId,
}: {
  visible: boolean;
  itemId: string | undefined;
  source: "detail" | "auto";
  pathItemId: string | null;
}): string | null {
  if (!visible) {
    return null;
  }
  if (itemId !== undefined) {
    return itemId;
  }
  return source === "detail" ? pathItemId : null;
}
