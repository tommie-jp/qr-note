// 下部操作バー用アイコン (docs/31-下部操作バー計画.md §3-3)
// 寸法は 24px (StrokeIcon の size="large")。タップ領域 44px に合わせて大きめ
//
// メニュー側と違い、色クラスは持たせず currentColor のまま置く。
// 選択スロットは押下中にバーごと bg-blue-600 + text-white へ反転するので、
// 色は反転を知っている使用側 (BottomActionBar) から与える (§11-1)

import { StrokeIcon, TINT } from "./primitives";

// スキャン: QR コードの枠 (メニューの QrIcon と同形、24px で拡大)。
// sizeClass … 検索窓の行 (SearchTools) だけ 20px に縮める — 隣の虫眼鏡・＋
// (20px) と大きさを揃えるため。className に size-5 を足す形では効かない理由は
// StrokeIcon (primitives.tsx) の sizeClass の注と同じ
export function ScanIcon({ sizeClass }: { sizeClass?: string }) {
  return (
    <StrokeIcon size="large" sizeClass={sizeClass}>
      <rect {...TINT} x="2" y="2" width="9" height="9" rx="1" />
      <rect {...TINT} x="13" y="2" width="9" height="9" rx="1" />
      <rect {...TINT} x="2" y="13" width="9" height="9" rx="1" />
      <path d="M13 13h4v4h-4zM22 13v0M13 22v0M22 22v4M22 19h1" />
    </StrokeIcon>
  );
}

// 画像検索: 写真フレーム + 虫眼鏡
export function ImageSearchIcon({ sizeClass }: { sizeClass?: string }) {
  return (
    <StrokeIcon size="large" sizeClass={sizeClass}>
      <rect {...TINT} x="3" y="3" width="12" height="12" rx="1" />
      <circle cx="8" cy="8" r="2" />
      <path d="M18 18l3.5 3.5M18 14a4 4 0 0 1 4 4" />
    </StrokeIcon>
  );
}

// 表示切替: リスト (コンパクト表示用)
export function ListViewIcon() {
  return (
    <StrokeIcon size="large">
      <path d="M8 6h12M8 12h12M8 18h12" />
      <rect {...TINT} x="3" y="4" width="2" height="2" rx="0.5" />
      <rect {...TINT} x="3" y="10" width="2" height="2" rx="0.5" />
      <rect {...TINT} x="3" y="16" width="2" height="2" rx="0.5" />
    </StrokeIcon>
  );
}

// 表示切替: 見出し + 副題の 2 行 (中表示用)。ListViewIcon (1 行) との差を
// 「行の下に細い 2 行目が付く」だけに抑えて、同じ表示スロットの仲間だと
// 判るようにする (ImageViewIcon が GridViewIcon と揃えているのと同じ判断)
export function ListDetailViewIcon() {
  return (
    <StrokeIcon size="large">
      <path d="M8 5h12M8 13h12" />
      <path d="M8 8.5h7M8 16.5h7" opacity="0.5" />
      <rect {...TINT} x="3" y="4" width="2" height="2" rx="0.5" />
      <rect {...TINT} x="3" y="12" width="2" height="2" rx="0.5" />
    </StrokeIcon>
  );
}

// 表示切替: グリッド (カード表示用)
export function GridViewIcon() {
  return (
    <StrokeIcon size="large">
      <rect {...TINT} x="3" y="3" width="7" height="7" rx="1" />
      <rect {...TINT} x="14" y="3" width="7" height="7" rx="1" />
      <rect {...TINT} x="3" y="14" width="7" height="7" rx="1" />
      <rect {...TINT} x="14" y="14" width="7" height="7" rx="1" />
    </StrokeIcon>
  );
}

// 表示切替: masonry (画像表示用)。高さ不揃いのタイルで「画像が敷き詰まる」
// 形にする。GridViewIcon (均等 2×2) との差は高さの不揃いだけに抑えて、
// 同じ「表示」スロットの仲間だと判るようにする。虫眼鏡付きの
// ImageSearchIcon は流用しない — 隣の「画像検索」スロットと同じ絵になり
// 狙えなくなる (docs/31 §11-1 の色と形で狙う原則)
export function ImageViewIcon() {
  return (
    <StrokeIcon size="large">
      <rect {...TINT} x="3" y="3" width="8" height="11" rx="1" />
      <rect {...TINT} x="13" y="3" width="8" height="7" rx="1" />
      <rect {...TINT} x="3" y="16" width="8" height="5" rx="1" />
      <rect {...TINT} x="13" y="12" width="8" height="9" rx="1" />
    </StrokeIcon>
  );
}

// 並び順: 上下矢印。面になるシェイプが無いのでティントは敷かない。
// 方向を持たない「並び替え」そのものの印で、長押しメニューの行頭に使う
export function SortIcon() {
  return (
    <StrokeIcon size="large">
      <path d="M12 5v14M5 12l7-7 7 7M5 12l7 7 7-7" />
    </StrokeIcon>
  );
}

// 並び順の方向 (docs/64-並び順逆順計画.md §4)。下部バーのスロットは
// **アイコンで方向を出す** — ラベルに「↓」を足すと、いちばん長い
// 「アクセス順」が 5 スロットの幅 (320px 端末で 1 枠 56px) からあふれる。
// 矢印の頭を片側だけにして、上下両向きの SortIcon と一目で見分かるようにする
export function SortDescIcon() {
  return (
    <StrokeIcon size="large">
      <path d="M12 4v16M6 14l6 6 6-6" />
    </StrokeIcon>
  );
}

export function SortAscIcon() {
  return (
    <StrokeIcon size="large">
      <path d="M12 20V4M6 10l6-6 6 6" />
    </StrokeIcon>
  );
}

// 選択: チェックボックス
export function SelectIcon() {
  return (
    <StrokeIcon size="large">
      <rect {...TINT} x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 12l3 3 6-6" />
    </StrokeIcon>
  );
}
