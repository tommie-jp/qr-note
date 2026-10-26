"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { getNavigation } from "@/components/chrome/navigationApi";
import { ClearIcon } from "@/components/icons";
import { ACTION_LINK_CLASS } from "@/components/ui";
import { closeNoteTargetIndex } from "./closeNote";

// 全画面の /item の「閉じる」(docs/86 §4-17)。
//
// ペインの「全画面で開く」は横取りを抜けるためのハード遷移で、着いた先は
// 素の /item — ペインにあった「閉じる」が無く、戻る手段がヘッダーの小さな ◀
// だけになっていた (実機で報告)。同じ位置に同じ見た目で置く。
//
// 押したときの行き先:
//   履歴にノートでない画面がある … そこまで戻る。ペイン・編集画面・「次 →」で
//                                   渡ったノートは飛ばす (closeNote.ts)
//   無い (QR シール・直リンク)    … 一覧へ。「ノートを閉じる = 一覧に居る」
//
// 判定は押した瞬間に行う。描画時に決めると、サーバとクライアントで
// 出す物が食い違う (履歴はクライアントでしか分からない)
export function CloseNoteButton({ listHref }: { listHref: string }) {
  const router = useRouter();
  // 押した回数。中断の後始末が、押し直した分の遷移を追い越さないようにする
  const pressCount = useRef(0);

  const close = () => {
    const navigation = getNavigation();
    // Navigation API 未対応 (Safari 26.2 未満) では履歴の中身が読めない。
    // 1 つ戻るだけにする (◀ と同じ)。history.length は外のサイトも数えるが、
    // QR シールから開いたばかりのタブ (= 1) だけは確実に見分けられる
    if (navigation === null) {
      if (window.history.length > 1) {
        window.history.back();
      } else {
        router.push(listHref);
      }
      return;
    }

    const entries = navigation.entries();
    const target = closeNoteTargetIndex(
      entries.map((entry) => entry.url),
      navigation.currentEntry?.index ?? -1,
    );
    if (target === null) {
      router.push(listHref);
      return;
    }
    // 別の文書へ戻るときは、この文書ごと捨てられて finished は解けない。
    // 解けずに失敗したとき (ほかの遷移に割り込まれた等) だけ記録に残す。
    //
    // **committed も受ける。** 中断されると両方が拒否され、片方だけ受けると
    // もう片方が「未処理の Promise 拒否」になる。
    //
    // **戻れなければ一覧へ倒す。** iPhone の PWA は圏外で別の文書へ戻ろうとすると
    // "Navigation aborted" で中断し、押しても何も起きない (実機ログで 5 秒に 5 回)。
    // まだこの画面に居て、その後に押し直していなければ、履歴が無いときと同じく
    // 一覧へ (圏外なら SW が /offline へ送る)
    const startKey = navigation.currentEntry?.key;
    const press = ++pressCount.current;
    const { committed, finished } = navigation.traverseTo(entries[target].key);
    committed.catch(() => {});
    finished.catch((error) => {
      console.warn("閉じる: 履歴を戻れませんでした", error);
      if (press === pressCount.current && navigation.currentEntry?.key === startKey) {
        router.push(listHref);
      }
    });
  };

  return (
    <button type="button" onClick={close} className={ACTION_LINK_CLASS}>
      <ClearIcon />
      閉じる
    </button>
  );
}
