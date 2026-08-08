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

  // 押下ごと無かったことにする (cancel に加えて握り潰す構えも倒す)。
  //
  // **click が来ないと判った時点で構えを倒す**のがこの関数の役目。
  // fired は「放した指の click を握り潰す」ための一時的な構えなので、
  // その click が二度と来ない経路では残してはいけない — 残ると次の活性化
  // (フォーカスの残った Enter / Space、読み上げソフトからの実行) を食べて、
  // 押しても何も起きないボタンになる。原因も見えない。
  //
  // 対象は「枠の外へ出た」「押下が取り消された」の 2 つ。**onPointerUp は
  // 含めない** — こちらは枠の中で離した合図で、click がこの後に必ず来る
  // (それを握り潰すのが本来の目的)。
  const abandonPress = () => {
    cancel();
    fired.current = false;
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
    // 枠の中で離した = この後に click が来る。構えは倒さない (それを
    // 握り潰すのが目的なので、倒すと長押しの後にフォームが送信される)
    onPointerUp: cancel,
    onPointerCancel: abandonPress,
    // 指・カーソルがスロットの外へ出たら取り消す。放した先が別のスロット
    // だったときに、押していないほうのメニューが出るのを防ぐ。
    //
    // 構えも倒す (abandonPress)。長押しでメニューが開いた直後、そのまま指を
    // 開いたメニューへ滑らせて外で離す — という自然な動きでは、この枠に
    // click が来ないため
    onPointerLeave: abandonPress,
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
      // **fired を立てるかは「まだ押している最中か」で決める。**
      //
      //   押している最中 … タッチの長押し。指を離せば click が続くので、
      //     ここで立てておかないと握り潰せない。**タイマーには任せられない** —
      //     Android Chrome は contextmenu をタイマーより先に投げてくることが
      //     あり、下の cancel() がそのタイマーを消してしまう。すると放した指の
      //     click が「ただのタップ」と見なされ、dismissOrCycle が開いたばかりの
      //     メニューをその場で閉じる (長押しが効かないように見える)
      //   押していない … PC の右クリック。続く click は無いので、立てたままだと
      //     次の活性化 (フォーカスが残ったままの Enter / Space、読み上げソフト
      //     からの実行) を食べてしまう。押しても何も起きないボタンになり、
      //     原因も見えない
      //
      // start は cancel() が畳むので、消える前に読む
      const isPressing = start.current !== null;
      cancel();
      if (isPressing) {
        fired.current = true;
      }
      onLongPress();
    },
    // キーボードからも開けるようにする。aria-haspopup で「メニューがある」と
    // 言っておきながら開く手が長押しだけだと、キーボードと読み上げソフトの
    // 利用者には嘘になる。↑ にするのはメニューが上へ出るため
    // (Enter / Space はスロット本来の循環に残す)
    onKeyDown: (event: React.KeyboardEvent) => {
      // **キーは必ず構えを倒してから振り分ける。**
      //
      // キーボードからの活性化 (Enter / Space) には押下が先行しないので、
      // fired を倒す機会がここにしかない。ポインタ側は次の onPointerDown が
      // 倒すため自然に治るが、キーボードだけは治る当てがなく、構えが
      // 残っていると「押しても何も起きないボタン」になる。
      //
      // 長押しやタッチの contextmenu の後に click が来ないブラウザがあり
      // (Android Chrome)、そこを踏んだ人がそのままフォーカスの残った
      // ボタンで Enter を押す、という順番で実際に起きる
      fired.current = false;
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
        return;
      }
      event.preventDefault();
      cancel();
      onLongPress();
    },
  };
}
