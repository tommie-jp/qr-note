import { isNotePathname } from "@/lib/search/url";

// 全画面ノートの「閉じる」が戻る履歴の位置 (docs/86 §4-17)。
//
// 今の位置から遡り、**ノートの画面 (isNotePathname) を飛ばして**最初に
// 見つかった画面を返す。無ければ null (呼ぶ側が一覧へ送る)。
//
// 1 つ戻るだけにしないのは、直前がノートの画面であることが多いため:
//   - ペインで開いていた同じノート (横取りの URL も /item/<番号>)
//   - 保存直後の編集画面 (Server Action の redirect は push なので残る)
//   - 「次 →」で渡ってきた前のノート
// どれに戻っても「閉じた」ことにならない。
//
// urls は Navigation API の entries() の url (同じオリジンの履歴だけ)。
// url が null の項目 (取得できない) はノートでない画面とみなして止まる —
// 飛ばしすぎて一覧より前へ出るより、手前で止まるほうが害が小さい
export function closeNoteTargetIndex(
  urls: readonly (string | null)[],
  currentIndex: number,
): number | null {
  for (let i = currentIndex - 1; i >= 0; i--) {
    const url = urls[i];
    if (url === null || url === undefined || !isNotePathname(pathnameOf(url))) {
      return i;
    }
  }
  return null;
}

function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}
