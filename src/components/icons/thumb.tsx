// 一覧のサムネ (RowThumb) とノートプレビュー (NotePreviewThumb) に描く図柄。
// もとはそれぞれの部品の中の inline svg。囲み (重ねる位置・読み上げ名) は
// 使う側が持つ

// 再生バッジの図柄 (半透明の黒丸に白の三角)。RowThumb が poster の中央に重ねる
export function PlayBadgeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-1/3 min-h-4 min-w-4 drop-shadow"
      fill="white"
    >
      <circle cx="12" cy="12" r="11" fill="rgba(0,0,0,0.45)" />
      <path d="M9 7.5v9l7-4.5z" fill="white" />
    </svg>
  );
}

// poster が無い動画の代役の図柄 (ビデオカメラ風の塗り)。下部バーの
// VideoIcon (録画ボタンの線画) とは別物
export function VideoThumbIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-2/3" fill="currentColor">
      <path d="M4 6h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zm13 3.5 4-2.5v10l-4-2.5z" />
    </svg>
  );
}

// 図・カードのフェンス (mermaid / circuitikz / quiz) の代役に描く図柄
// (箱 2 つをつなぐ線)。NotePreviewThumb の FencePlaceholder が囲む
export function DiagramIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden
    >
      <rect x="3" y="3" width="7" height="6" rx="1" />
      <rect x="14" y="15" width="7" height="6" rx="1" />
      <path d="M6.5 9v6a3 3 0 0 0 3 3H14" />
    </svg>
  );
}
