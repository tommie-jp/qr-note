// ヘッダーの帯に置くボタンのアイコン (☰ / ✕・戻る / 進む・ペイン構成)。
// もとはそれぞれ HeaderMenu / HistoryNav / PaneModeButton の中の inline svg。
// 色は使う側 (ボタンの文字色) に従う。PaneModeIcon だけは 3 つのペインを
// 塗り分けるので自前で持つ

import type { PaneMode } from "@/lib/paneMode";

// メニューの開閉ボタン (HeaderMenu) の ☰ / ✕。アイコンは inline SVG で持つ。
// この 2 本のためにライブラリを足さない (currentColor なので文字色にそのまま
// 追従する)。
//
// viewBox は線のインク (stroke 2 + 丸キャップの張り出しを含む) に
// ぴったり合わせる。余白を残すと、ヘッダーのベースライン揃えで
// 「svg の下端 = ベースライン」に載せたとき線だけ浮いて見える。
// h-[1cap] で 3 本線の全高が大文字 Q と同じになり、下の線が
// ベースラインに載る
export function MenuToggleIcon({ isOpen }: { isOpen: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="3 6 18 12"
      className="h-[1cap] w-auto"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
    >
      {isOpen ? (
        <path d="M7 7l10 10M17 7L7 17" />
      ) : (
        <path d="M4 7h16M4 12h16M4 17h16" />
      )}
    </svg>
  );
}

// 戻る / 進むボタン (HistoryNav) の塗りつぶしの三角。文字の ◀ ▶ (U+25C0/25B6) は iOS が絵文字として描くため
// CSS の色が効かず、字形も端末ごとに変わる。矢印 ← → より面が広く、色を
// 乗せたときに小さくても目に入る。
//
// 角を丸めるのに線を重ねる (fill と同色の stroke + linejoin round)。
// 尖った三角は、ヘッダーの丸い文字組みの中で 1 つだけ硬く見える
export function TriangleIcon({ direction }: { direction: "back" | "forward" }) {
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

// ペイン構成ボタン (PaneModeButton) のアイコン (docs/86 §4-4)。**いまの構成そのものを描く** —
// 押した先ではなく現状を見せる (下部バーの表示モードと同じ流儀)。
//
// 色は 3 つのペインで塗り分ける: フォルダー=青 / 検索結果=緑 / ノート=琥珀。
// 数字と合わせて、形と色と数の 3 通りで同じことを言う
export function PaneModeIcon({ mode }: { mode: PaneMode }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="size-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      {/* 外枠 (画面) */}
      <rect x="2.5" y="4.5" width="19" height="15" rx="2" className="text-gray-400" />
      {mode === "3" && (
        <>
          {/* 左: フォルダー */}
          <rect x="2.5" y="4.5" width="6" height="15" rx="2" className="fill-blue-500/70 stroke-blue-600" />
          {/* 右上: 検索結果 */}
          <rect x="8.5" y="4.5" width="13" height="8" className="fill-emerald-500/70 stroke-emerald-600" />
          {/* 右下: ノート */}
          <rect x="8.5" y="12.5" width="13" height="7" className="fill-amber-400/70 stroke-amber-500" />
        </>
      )}
      {mode === "2" && (
        <>
          <rect x="2.5" y="4.5" width="19" height="8" rx="2" className="fill-emerald-500/70 stroke-emerald-600" />
          <rect x="2.5" y="12.5" width="19" height="7" rx="2" className="fill-amber-400/70 stroke-amber-500" />
        </>
      )}
      {mode === "1" && (
        <rect x="2.5" y="4.5" width="19" height="15" rx="2" className="fill-emerald-500/70 stroke-emerald-600" />
      )}
    </svg>
  );
}
