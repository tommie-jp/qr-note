"use client";

import { useEffect, useEffectEvent, useRef } from "react";

interface SlotMenuProps {
  // 何を選ぶメニューか (読み上げ用)。見出しの文字は出さない —
  // 3 行しかない選択肢に見出しを足すと、開いた瞬間の高さが倍になる
  label: string;
  // このメニューを開いたスロットのボタン。ここへの押下では閉じない
  // (閉じるのはボタン自身の役目。理由は下の onPointerDown)
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  children: React.ReactNode;
}

// 下部バーのスロットを長押ししたときに、その真上へ出す小さな選択メニュー
// (docs/62-下部バー長押し計画.md §3)。
//
// **absolute で出す。fixed は使えない。** バー (BOTTOM_BAR_CLASS) は
// backdrop-blur を持ち、backdrop-filter のある要素は position:fixed の
// 包含ブロックになるので、fixed の inset がバーの矩形を指してしまう
// (BottomActionBar がモーダルを nav の外へ出しているのと同じ罠)。
// absolute はもともと直近の position 付き祖先 = スロットが基準なので影響を
// 受けず、bottom-full だけでバーの上端に接して開く。
//
// 外側タップ用の覆いは置かない。覆いは fixed で全画面を覆う必要があり、
// 上の理由でこの中には置けず、portal で body へ出すと今度は覆いが
// メニュー自身より上に来る (HeaderMenu が z-40 のシートも一緒に portal して
// いるのはこのため)。3 行のメニューに背面の暗転は要らないので、
// document の pointerdown を capture で拾うだけにする。
export function SlotMenu({
  label,
  anchorRef,
  onClose,
  children,
}: SlotMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  // 呼ぶ側が毎描画で新しい関数を渡しても、購読をやり直さないようにする
  const close = useEffectEvent(() => onClose());

  useEffect(() => {
    // click ではなく pointerdown。iOS Safari は素の要素へのタップで
    // document まで click が上がらないことがある (HeaderMenu が覆いを
    // 実体のある要素にしているのと同じ事情) が、pointerdown は必ず届く。
    // capture … 途中で stopPropagation する部品があっても閉じられるように
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        close();
        return;
      }
      if (menuRef.current?.contains(target)) {
        return;
      }
      // **開いたボタン自身への押下では閉じない。** ここで閉じると、
      // 続いて起きる click は「メニューを消すつもりのタップ」なのに
      // スロット本来の送信として通ってしまい、閉じたうえに表示モードまで
      // 1 つ進む。ボタン側が「開いているなら閉じるだけ」に振り分けられる
      // よう、押下はそのまま渡す (BottomActionBar の toggleMenu)
      if (anchorRef.current?.contains(target)) {
        return;
      }
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [anchorRef]);

  return (
    // 位置決めと動きを別の要素に分ける。
    //
    // **1 枚に重ねてはいけない。** 中央寄せの -translate-x-1/2 は Tailwind v4
    // では transform ではなく `translate` プロパティで出る。せり上がりの
    // animation (sheet-up) も `translate` を animation-fill-mode: both で
    // 動かすので、同じ要素に置くと終了後もアニメーション側の `translate: 0 0`
    // が残り続け、中央寄せが丸ごと消える。実際それで、右寄りのスロット
    // (並び順) のメニューが画面の右端からはみ出して文字が切れていた
    <div
      // left-1/2 -translate-x-1/2 … スロットの中心に揃える。スロットは
      // 64px 前後しかないので、左端に合わせるとメニューが隣のスロットの
      // 上に偏って、どれを長押ししたのか判らなくなる
      className="absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2"
    >
      <div
        ref={menuRef}
        role="menu"
        aria-label={label}
        // max-w … 端のスロットで画面外へはみ出さないための保険
        // (はみ出すと横スクロールが出る)
        className="flex w-max max-w-[80vw] flex-col overflow-hidden rounded-lg border border-gray-300 bg-white py-1 shadow-[0_4px_16px_rgba(0,0,0,0.18)] motion-safe:animate-sheet-up"
      >
        {children}
      </div>
    </div>
  );
}
