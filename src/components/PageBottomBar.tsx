"use client";

import { useBottomBar } from "@/components/BottomBarContext";
import {
  BOTTOM_BAR_CLASS,
  BOTTOM_BAR_INNER_CLASS,
  BOTTOM_BAR_SPACER_CLASS,
} from "@/components/ui";

// 検索画面 (BottomActionBar) 以外のページで使う下部バー。layout から全ページに
// 敷くが、中身は「差し込み口」だけ — ノート編集中に MemoEditorInner が編集ボタン
// (更新・元に戻す…) をここへ portal する (docs/31 の続き)。
//
// もとは左端に ← → (戻る/進む) を常設していたが、ヘッダーへ移した
// (docs/11 §5-2)。その結果、編集していないページでは中身が空になる。空の帯を
// 画面下端に残すと、本文が隠れるぶんだけ損なので、差し込む側がいないときは
// 帯も余白も描かない。いるかどうかは context の hasSlot が持つ。

export function BottomBarShell({
  isProd,
  hostRef,
}: {
  isProd: boolean;
  hostRef: (el: HTMLElement | null) => void;
}) {
  return (
    <>
      {/* バーぶんの余白。これがないとページ末尾がバーに隠れる
          (BottomActionBar と同じ理由)。編集帯もツールスロットが min-h-11 で
          高さは同じなので、余白は 1 種類で足りる */}
      <div aria-hidden className={BOTTOM_BAR_SPACER_CLASS} />

      <nav
        aria-label="編集操作"
        className={`${BOTTOM_BAR_CLASS} ${
          isProd ? "border-gray-200 bg-white/95" : "border-pink-300 bg-pink-100/95"
        }`}
      >
        <div className={BOTTOM_BAR_INNER_CLASS}>
          {/* 編集ボタンの差し込み口。min-w-0 で中の横スクロール帯が縮められる */}
          <div ref={hostRef} className="flex min-w-0 flex-1 items-stretch" />
        </div>
      </nav>
    </>
  );
}

export function PageBottomBar({ isProd }: { isProd: boolean }) {
  // 差し込み口の DOM を context に登録する。編集側 (MemoEditorInner) はこれを
  // 読んで portal する。callback ref を使うと、口が出来た瞬間に購読側へ伝わる
  const { hasSlot, setHostEl } = useBottomBar();
  if (!hasSlot) return null;

  return <BottomBarShell isProd={isProd} hostRef={setHostEl} />;
}
