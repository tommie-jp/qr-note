import { unstable_rethrow } from "next/navigation";

// ノート 1 件へのサーバーアクション (ゴミ箱へ移動・復元・永久削除)。
// どれも FormData に itemId を載せて呼ぶ
export type NoteAction = (formData: FormData) => void | Promise<void>;

// サーバーアクションを 1 回呼ぶ。成功なら true、本物の失敗なら false。
// 行 (useRowTrash) と画像モードのタイル (TileActions) が共有する。
//
// **成功しても例外は飛んでくる。** trashItemsAction は最後に redirect() を
// 呼び、これは内部エラーを投げることで動く仕組みなので、素の catch は成功
// した削除まで「失敗」にしてしまう (実際、消えた行の上に一瞬エラーが出て
// いた)。フレームワークの例外はここで投げ直す
export async function sendNoteAction(
  action: NoteAction,
  formData: FormData,
): Promise<boolean> {
  try {
    await action(formData);
    return true;
  } catch (error) {
    unstable_rethrow(error);
    return false;
  }
}
