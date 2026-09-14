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
  // どこを軸に開くか。既定の center は下部バーのスロット用 — スロットは
  // 帯の全幅に等間隔で並ぶので、中心に揃えれば画面内に収まる。
  //
  // **端に寄った小さなボタンでは center が使えない** (docs/70 §6)。
  // 書式ボタンは帯の左寄りにあり、中心を軸にすると幅 190px 前後の
  // メニューが画面の左外へ 13px はみ出して記法の見本が切れる (実機で確認)。
  // start はボタンの左端を軸にして右へ開く
  align?: "center" | "start";
  // どちら側へ開くか。既定の top は下部バー用 (帯の上へせり上がる)。
  // 検索結果の見出し行に置くスロット (docs/86 §4-11) は画面の上側にあり、
  // 上へ開くと検索窓を覆うので bottom で下向きに開く
  side?: "top" | "bottom";
  children: React.ReactNode;
}

// 位置決めの土台。動き (motion-safe:animate-sheet-up) とは**別の要素**に
// 分けてあるので、ここは translate を自由に使える (下のコメント参照)
const ALIGN_CLASS: Record<"center" | "start", string> = {
  center: "left-1/2 -translate-x-1/2",
  start: "left-0",
};

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
  align = "center",
  side = "top",
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
      // center … スロットの中心に揃える。スロットは 64px 前後しかないので、
      // 左端に合わせるとメニューが隣のスロットの上に偏って、どれを長押し
      // したのか判らなくなる (端に寄ったボタンで start を使う理由は上の align)
      className={`absolute z-10 ${
        side === "top" ? "bottom-full mb-1" : "top-full mt-1"
      } ${ALIGN_CLASS[align]}`}
    >
      <div
        ref={menuRef}
        role="menu"
        aria-label={label}
        // max-w … 端のスロットで画面外へはみ出さないための保険
        // (はみ出すと横スクロールが出る)
        //
        // max-h + overflow-y-auto … **項目が増えたときの保険**。この帯は
        // 画面の下端にあり、メニューは上へ開く。書式メニューのように 10 行を
        // 超えると、スマホの縦では画面の上へ突き抜けて先頭の項目に届かなく
        // なる。届かない項目は無いのと同じなので、中でスクロールさせる
        // (下部バーの 3 行メニューはここに当たらない)
        className={`flex max-h-[60vh] w-max max-w-[80vw] flex-col overflow-y-auto overscroll-contain rounded-lg border border-gray-300 bg-white py-1 shadow-[0_4px_16px_rgba(0,0,0,0.18)] ${
          // せり上がりは下から開くときだけ。下向きに開くのに下から
          // せり上がると、出どころと動きの向きが食い違う
          side === "top" ? "motion-safe:animate-sheet-up" : ""
        }`}
      >
        {children}
      </div>
    </div>
  );
}
