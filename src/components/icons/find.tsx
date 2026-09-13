// ノート内検索 (docs/76-ノート内検索計画.md) の検索バーの中の小さなボタン (20px)。
// 色は持たせない — 押せない間 (0 件) は薄く、押せる間は文字色に従う

import { StrokeIcon } from "./primitives";

// 前の一致 / 次の一致。∧ ∨ は「上の一致へ / 下の一致へ」で、本文の並び順
// そのもの。← → にしないのは、横書きの本文で左右が「行の中の移動」に見えるため
export function ChevronUpIcon() {
  return (
    <StrokeIcon>
      <path d="M6 15l6-6 6 6" />
    </StrokeIcon>
  );
}

export function ChevronDownIcon() {
  return (
    <StrokeIcon>
      <path d="M6 9l6 6 6-6" />
    </StrokeIcon>
  );
}

// 置換行を開く。2 本の矢印が入れ替わる形で「置き換え」を表す
export function ReplaceIcon() {
  return (
    <StrokeIcon>
      <path d="M4 8h13l-3-3M20 16H7l3 3" />
    </StrokeIcon>
  );
}
