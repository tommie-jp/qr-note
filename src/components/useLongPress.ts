"use client";

import { useEffect, useRef } from "react";
import {
  hasLeftPressArea,
  LONG_PRESS_MS,
  type PressPoint,
} from "@/lib/longPress";

// 長押しでメニューを開くための手 (docs/62-下部バー長押し計画.md)。
//
// 下部バーのスロットは短いタップで値を循環させるトグルなので、長押しは
// **その循環を飛ばして直接選ぶ近道**として足す。既存の押し方は変えない。
//
// 要点は 3 つ:
//
//   1. 指が動いたら取り消す … バーの真上を指がかすめてスクロールするたびに
//      メニューが出ては使い物にならない (lib/longPress.ts の閾値)。
//   2. 長押しが成立したら click を握り潰す … スロットはフォームの submit
//      ボタンで、放した指がそのまま送信すると「メニューを出したのに
//      表示モードも切り替わっていた」になる。
//   3. contextmenu を止める … Android は長押しで、PC は右クリックで出る
//      ブラウザ既定のメニューが、こちらのメニューに重なる。止めたうえで
//      右クリックはメニューを開く合図として使う (長押しできない環境の代替)。
//
// pointer 系で拾うのは touch と mouse を 1 本で書けるため。touchstart と
// mousedown を並べると、touch 環境で両方が発火して二重に走る。
export function useLongPress(onLongPress: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<PressPoint | null>(null);
  // 長押しが成立したか。放したときの click を握り潰すかの判断に使う
  const fired = useRef(false);
  // onLongPress は ref にも useEffectEvent にも包まない。この手は毎描画で
  // 作り直される (返すのはそのつど新しいオブジェクト) ので、掴むのは
  // 「押し始めた時点の」関数になる。押してから 0.5 秒のあいだに中身が
  // 変わるような呼び方はしていないため、包む値打ちがない

  const cancel = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    start.current = null;
  };

  // 押したまま画面が切り替わった (選択モードへ入ったなど) ときに、
  // 消えた部品のタイマーが後から発火しないようにする
  useEffect(() => cancel, []);

  return {
    onPointerDown: (event: React.PointerEvent) => {
      // 主ボタンだけ。右クリック (button 2) は onContextMenu が受ける
      if (event.button !== 0) {
        return;
      }
      cancel();
      fired.current = false;
      start.current = { x: event.clientX, y: event.clientY };
      timer.current = setTimeout(() => {
        timer.current = null;
        fired.current = true;
        onLongPress();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (event: React.PointerEvent) => {
      if (
        start.current &&
        hasLeftPressArea(start.current, { x: event.clientX, y: event.clientY })
      ) {
        cancel();
      }
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    // 指・カーソルがスロットの外へ出たら取り消す。放した先が別のスロット
    // だったときに、押していないほうのメニューが出るのを防ぐ
    onPointerLeave: cancel,
    // 握り潰したかを返す。呼ぶ側が「長押しの後始末だったのか、普通の
    // タップだったのか」で続きを振り分けられるようにするため
    // (BottomActionBar の dismissOrCycle)。React の型は void を期待するが、
    // 戻り値のある関数を渡すのは許されている
    onClick: (event: React.MouseEvent) => {
      if (!fired.current) {
        return false;
      }
      // 送信も遷移もさせない。次の押下のために倒しておく
      fired.current = false;
      event.preventDefault();
      event.stopPropagation();
      return true;
    },
    onContextMenu: (event: React.MouseEvent) => {
      event.preventDefault();
      // 右クリックは長押しと同じ意味にする。タッチの長押しで先に
      // contextmenu が来た場合も、開く先は同じなので二重でも害はない。
      //
      // **ここで fired は立てない。** 右クリックに続く click は無いので、
      // 立てたままだと次の活性化 (フォーカスが残ったままの Enter / Space、
      // 読み上げソフトからの実行) を握り潰してしまう。押しても何も
      // 起きないボタンになり、原因も見えない。タッチの長押しで
      // contextmenu が来る場合は、タイマー側がすでに立てている
      cancel();
      onLongPress();
    },
    // キーボードからも開けるようにする。aria-haspopup で「メニューがある」と
    // 言っておきながら開く手が長押しだけだと、キーボードと読み上げソフトの
    // 利用者には嘘になる。↑ にするのはメニューが上へ出るため
    // (Enter / Space はスロット本来の循環に残す)
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
        return;
      }
      event.preventDefault();
      cancel();
      onLongPress();
    },
  };
}
