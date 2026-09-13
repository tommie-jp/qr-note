// アイコンの土台 (docs/11-アプリ的UIUX計画.md §6、docs/31-下部操作バー計画.md §11)。
// 個々のアイコンは置き場ごとのファイル (menu / bottomBar / search / editor /
// find / actions / note / header / thumb) にあり、使う側は icons/index.ts から読む。
//
// アイコンライブラリは足さない。必要なのはここの数個だけで、そのために
// 依存とバンドルを増やす釣り合いが取れない (HeaderMenu の ☰ / ✕ を
// inline SVG で持っているのと同じ判断。いまは header.tsx の MenuToggleIcon)。
//
// 線は currentColor で描く。色を「アイコン側」で持つか「使用側」から与えるかは
// 置き場ごとに違う (docs/31-下部操作バー計画.md §11-4) — 各ファイルの頭に書いた。
//
// aria-hidden なのは、隣に必ず同じ意味の文字があるため — 読み上げに
// 「QR コード QR コード」と二重に出さない。

// 20px。メニューの行頭・検索窓の行・ノートの見出し行
export const SIZE_CLASS = "size-5 shrink-0";

// 24px。下部操作バー (docs/31-下部操作バー計画.md §3-3) — SIZE_CLASS は 20px だが、
// ここはタップ領域 44px に合わせて大きめ
const BOTTOM_BAR_ICON_CLASS = "size-6 shrink-0";

// 面になるシェイプに敷く薄い塗り。線 1 色のまま二階調にして、平板な線画より
// 目に留まるようにする (§11-1)。塗り分けに 2 色目を使わないので、
// 色の指定はアイコン 1 個につき 1 つで済む
export const TINT = { fill: "currentColor", fillOpacity: 0.15 } as const;

// regular … 20px (SIZE_CLASS)。large … 24px (BOTTOM_BAR_ICON_CLASS、下部バー)
type StrokeIconSize = "regular" | "large";

const STROKE_ICON_SIZE_CLASS: Readonly<Record<StrokeIconSize, string>> = {
  regular: SIZE_CLASS,
  large: BOTTOM_BAR_ICON_CLASS,
};

// 線画のアイコンで共通の描き方。塗りではなく線で描くのは、メニューの
// 文字 (font-medium) と線の太さが揃って馴染むため。
// もとは 20px の StrokeIcon と 24px の StrokeIconLarge の 2 つだったが、
// 違いは既定の寸法だけなので size で選ぶ 1 つにした (docs/93-リファクタリング計画.md §3-2)
//
// sizeClass … 既定 (size で選んだ 20px / 24px) を**差し替える**ための口。
// className に size-4 を足す形では効かない — Tailwind の同種ユーティリティは
// class 属性の並び順ではなく生成 CSS の並び順で勝敗が決まるので、size-5 が
// 残って効かないことがある。使う側が「どちらが勝つか」を読めないのは危ないので、
// 差し替えは別の口にする
export function StrokeIcon({
  children,
  className,
  size = "regular",
  sizeClass = STROKE_ICON_SIZE_CLASS[size],
}: {
  children: React.ReactNode;
  className?: string;
  size?: StrokeIconSize;
  sizeClass?: string;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={className ? `${sizeClass} ${className}` : sizeClass}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}
