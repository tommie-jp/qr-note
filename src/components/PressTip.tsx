"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLongPress } from "@/components/useLongPress";
import type { PressPoint } from "@/lib/longPress";

// 長押しで出る吹き出し (docs/82-ノート操作アイコン計画.md §5)。
//
// アイコンにした操作は、絵だけでは何をするか判らないことがある。PC は
// `title` のホバーで読めるが、**スマホにはホバーが無い** — 帯をやめたときに
// 説明を tooltip へ移した判断 (docs/75 §3) が、スマホでは「読めない場所へ
// 移した」になっていた。長押しをその読み口にする。
//
// **子ではなく包みに手を付ける。** 中身は Link だったり `<form>` の中の
// submit ボタンだったりと様々で、それぞれに長押しの結線を配ると同じ仕掛けが
// 散らばる。包み 1 枚で済ませられるのは、押下も click も包みまで上がってくるため。
//
// **握り潰しは onClickCapture でなければならない。** 長押しを終えて指を離すと
// click が続き、そのままだと「説明を読んだだけ」で編集画面へ飛ぶ・フォームが
// 送信される。包みの onClick (バブリング) では遅い —
//   - next/link は自分の onClick の中で遷移を始める (defaultPrevented を
//     見るのはその前だけ) ので、包みに届いた頃にはもう飛んでいる
//   - ConfirmSubmitButton は自分の onClick で window.confirm を出すので、
//     長押ししただけで確認ダイアログが開く
// capture なら子の onClick より先に走り、stopPropagation でそれ自体を止められる。
//
// 右クリックはブラウザ既定のメニューに任せる (rightClick: "native")。PC には
// ホバーの tooltip があるので奪う理由が無く、リンクの「アドレスをコピー」を
// 潰すほうが損 (docs/66 §5-2 と同じ判断)。

interface PressTipProps {
  // 吹き出しに出す説明。PC のホバー (title) にも同じ文を使う
  label: string;
  children: ReactNode;
  className?: string;
}

// 出しっぱなしにしない。指を離した後もしばらく残すのは、長押しの途中で
// 読み始める人がいないため (吹き出しは指で隠れた場所に出る)
const TIP_VISIBLE_MS = 2000;

// 押した点からどれだけ離して出すか。指そのものが吹き出しを隠さない距離
const TIP_GAP_PX = 20;

// これより上を押したときは、吹き出しを指の**下**へ出す。画面の上端に近いと
// 上に出す余地が無く、出しても切れて読めない
const TIP_ABOVE_MIN_Y = 96;

// 横位置は画面を 3 つに割って寄せる。押した点にぴったり合わせると、端の
// アイコン (行の左端の公開トグル・右端の記法) で吹き出しが画面の外へ出て、
// **ページごと横スクロールする** — 説明を読むために画面が横へずれるのは、
// 位置が少しずれるより悪い。器を inset-x-2 の全幅にしておけば、寄せるだけで
// はみ出しは起きない
export function tipAlign(x: number, width: number): string {
  if (x < width / 3) {
    return "justify-start";
  }
  return x > (width * 2) / 3 ? "justify-end" : "justify-center";
}

export function PressTip({ label, children, className = "" }: PressTipProps) {
  // 押した点。null = 出ていない
  const [point, setPoint] = useState<PressPoint | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const press = useLongPress(
    (pressed) => {
      setPoint(pressed);
      if (timer.current) {
        clearTimeout(timer.current);
      }
      timer.current = setTimeout(() => {
        timer.current = null;
        setPoint(null);
      }, TIP_VISIBLE_MS);
    },
    { rightClick: "native" },
  );

  // 押したまま画面が切り替わっても、消えた部品のタイマーが後から発火しない
  // ようにする (useLongPress が自分のタイマーにしているのと同じ後始末)
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  // 出ている間は、他の場所への押下とスクロールで消す。**吹き出しは fixed** な
  // ので、スクロールしても付いてこない — 指を離した後にスクロールを始めると、
  // 何も指していない吹き出しが画面に貼り付いたまま残る。
  // capture で拾うのは、途中で stopPropagation する部品があっても届かせるため
  // (SlotMenu の外側タップと同じ作法)
  useEffect(() => {
    if (point === null) {
      return;
    }
    const dismiss = () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      setPoint(null);
    };
    document.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [point]);

  // 握り潰しを capture 側へ移し替える (上のコメント)。onClick の中身は
  // preventDefault + stopPropagation なので、capture で呼べばそのまま効く
  const { onClick, onPointerDown, onKeyDown, ...rest } = press.handlers;
  const handlers = {
    ...rest,
    // 次の押下では前の吹き出しを消してから測り直す
    onPointerDown: (event: React.PointerEvent) => {
      setPoint(null);
      onPointerDown(event);
    },
    onClickCapture: onClick,
    // **↑ ↓ は本来のスクロールに残す。** useLongPress の鍵操作は「長押しの
    // 代わりにメニューを開く」ためのもので (docs/62 §3)、開く物を持たない
    // こちらでは、キーボードの利用者がリンクに焦点を置いたまま画面を
    // 送れなくなるだけになる。
    //
    // 矢印以外は素通しする — あちらは押下が先行しない活性化 (Enter / Space) の
    // ために「握り潰す構え」を倒しており、それを落とすと長押しの後に click が
    // 来なかった端末 (Android Chrome) で、次の Enter が食べられる
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        return;
      }
      onKeyDown(event);
    },
  };

  return (
    // select-none / touch-callout … 長押しは既定では文字の選択と、iOS の
    // 「コピー / 調べる」やリンクのプレビューを呼ぶ。どれもこの吹き出しに
    // かぶる (BOTTOM_BAR_CLASS が同じ理由で持っているのと同じ指定)
    <span
      className={`inline-flex select-none [-webkit-touch-callout:none] ${className}`}
      title={label}
      {...handlers}
    >
      {children}
      {point !== null &&
        createPortal(
          // **portal で body へ出す。** fixed の基準は直近の filter /
          // backdrop-filter / transform を持つ祖先になるので、その中に置くと
          // 画面ではなく祖先の矩形が基準になる (SlotMenu が fixed を避けた罠)。
          // 押した点に出す物なので、基準は必ず画面でなければならない。
          //
          // aria-hidden … 読み上げには要らない。同じ文が包みの title に、
          // 操作の名前はボタン自身の文字か aria-label に既に居る
          <div
            aria-hidden
            className={`pointer-events-none fixed inset-x-2 z-40 flex ${tipAlign(
              point.x,
              window.innerWidth,
            )}`}
            style={
              point.y >= TIP_ABOVE_MIN_Y
                ? { top: point.y - TIP_GAP_PX, transform: "translateY(-100%)" }
                : { top: point.y + TIP_GAP_PX }
            }
          >
            <span className="max-w-xs rounded bg-gray-900/90 px-3 py-1.5 text-sm leading-snug text-white shadow-lg">
              {label}
            </span>
          </div>,
          document.body,
        )}
    </span>
  );
}
