"use client";

import { useSyncExternalStore } from "react";

// ヘッダーのサイト名・バージョンの右に置く「戻る (◀)」「進む (▶)」ボタン
// (docs/11-アプリ的UIUX計画.md §5-1, §5-2)。
//
// 置き場所は ヘッダー → 下部バーの左端 → ヘッダー と往復している。下端は親指が
// 届くが、ノート編集中は編集ボタンの帯と場所を取り合い、5 スロットの並びに
// 矢印 2 つが割り込む形にもなっていた。ヘッダーなら全ページで位置が動かない。
//
// もとは standalone (ホーム画面起動) のときだけ出す ← 一本だった。standalone は
// ブラウザの戻るがなく iOS では画面端スワイプ頼み (しかも初回は効かない) なため。
// いまはブラウザで開いたときも含め ◀ ▶ を常時出す。使えない向き (戻る/進む先が
// ない) はボタンを disabled にして薄く見せる。
//
// 使える/使えないの判定は Navigation API (navigation.canGoBack/canGoForward) で行う。
// Chrome/Edge 102+・Firefox 147+・Safari 26.2+ が対応。未対応ブラウザでは判定できない
// ので両方 active に倒す (押しても行き先がなければ no-op で無害)。
//
// サーバ描画時とクライアント初回では可否が分からないので、外部システム (Navigation
// API) の購読は useSyncExternalStore で行う。サーバ側 (getServerSnapshot) は常に
// false を返し、ハイドレーション後にクライアント側の実値へ差し替わる。

// TS の lib.dom.d.ts にはまだ Navigation API が無いので、使う分だけ最小宣言する。
interface NavigationApi extends EventTarget {
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
}

function getNavigation(): NavigationApi | null {
  if (typeof window === "undefined" || !("navigation" in window)) return null;
  return (window as unknown as { navigation: NavigationApi }).navigation;
}

// 遷移のたびに現在地が変わり、戻る/進む先の有無も変わる。currententrychange で購読する
function subscribe(onChange: () => void): () => void {
  const navigation = getNavigation();
  if (!navigation) return () => {};
  navigation.addEventListener("currententrychange", onChange);
  return () => navigation.removeEventListener("currententrychange", onChange);
}

// getSnapshot は参照が安定した値 (ここでは boolean) を返す必要がある。
// 向きごとに 1 つずつ購読する
function useCanGo(direction: "back" | "forward"): boolean {
  return useSyncExternalStore(
    subscribe,
    () => {
      const navigation = getNavigation();
      // 未対応ブラウザ: 判定できないので押せるままにしておく
      if (!navigation) return true;
      return direction === "back"
        ? navigation.canGoBack
        : navigation.canGoForward;
    },
    // サーバ描画・ハイドレーション時は可否不明なので disabled 側に倒す
    () => false,
  );
}

// 塗りつぶしの三角。文字の ◀ ▶ (U+25C0/25B6) は iOS が絵文字として描くため
// CSS の色が効かず、字形も端末ごとに変わる。矢印 ← → より面が広く、色を
// 乗せたときに小さくても目に入る。
//
// 角を丸めるのに線を重ねる (fill と同色の stroke + linejoin round)。
// 尖った三角は、ヘッダーの丸い文字組みの中で 1 つだけ硬く見える
function TriangleIcon({ direction }: { direction: "back" | "forward" }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="size-5"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinejoin="round"
    >
      <path d={direction === "back" ? "M15 5 8 12l7 7z" : "M9 5l7 7-7 7z"} />
    </svg>
  );
}

// px-1.5 + 親の gap-1 で、三角どうしは 16px 離れる。並んだ 2 ボタンは押し間違え
// やすく、しかも「戻る」の押し間違いは進む先を捨てる (履歴の先が消える) —
// 取り返しがつかない側なので、ここは 0 にしない。
//
// min-h-11 … 見た目は 20px の三角でも、タップ目標は 44px を確保する。
// 帯の高さを押し上げないよう、親側が負のマージンで打ち消す (HeaderMenu と同じ)
const BUTTON_CLASS =
  "flex min-h-11 items-center justify-center rounded px-1.5 text-sky-600 transition-colors active:bg-sky-100 disabled:text-gray-300 disabled:active:bg-transparent";

export function HistoryNav() {
  const canGoBack = useCanGo("back");
  const canGoForward = useCanGo("forward");

  return (
    // ヘッダーの行は items-baseline (文字の大きさが揃わないため) だが、
    // 中身が図形のこの塊にベースラインは無い。self-center で行の中央に置き、
    // -my-1.5 で min-h-11 のはみ出しぶんを帯の高さから外す。
    //
    // -mx-1 … ヘッダーの行は flex-wrap で、収まらないと 2 行に折り返る
    // (layout.tsx の flex-wrap の注)。三角 2 つを足すだけで既定の文字サイズでも
    // 折り返る幅だったので、隣との隙間は行の gap-2 (8px) に任せ、ボタン自身の
    // 余白ぶんを外へ食い込ませて実効幅を詰める。隣 (版・目印・ユーザー名) は
    // どれも押す物ではないので、当たり判定が重なっても取り合いにならない
    <div className="-mx-1 -my-1.5 flex shrink-0 items-center gap-1 self-center">
      <button
        type="button"
        onClick={() => window.history.back()}
        disabled={!canGoBack}
        aria-label="前の画面に戻る"
        className={BUTTON_CLASS}
      >
        <TriangleIcon direction="back" />
      </button>
      <button
        type="button"
        onClick={() => window.history.forward()}
        disabled={!canGoForward}
        aria-label="次の画面に進む"
        className={BUTTON_CLASS}
      >
        <TriangleIcon direction="forward" />
      </button>
    </div>
  );
}
