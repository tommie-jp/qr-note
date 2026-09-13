// ノート編集の下部バー用アイコン (docs/31 と同じ 24px、StrokeIcon の size="large")。
// 色は使用側 (EditToolbar) から与える。隣に必ず同じ意味の文字ラベルがある。

import { StrokeIcon, TINT } from "./primitives";

// 更新 (保存): フロッピー。主ボタンなので他と混ざらない普遍的な保存の絵にする
export function SaveIcon() {
  return (
    <StrokeIcon size="large">
      <path
        {...TINT}
        d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"
      />
      <path d="M8 4v5h7V4M8 21v-6h8v6" />
    </StrokeIcon>
  );
}

// 元に戻す (undo): 左へ回り込む矢印
export function UndoIcon() {
  return (
    <StrokeIcon size="large">
      <path d="M9 7L4 12l5 5M4 12h10a6 6 0 0 1 6 6v1" />
    </StrokeIcon>
  );
}

// やり直す (redo): undo の左右反転
export function RedoIcon() {
  return (
    <StrokeIcon size="large">
      <path d="M15 7l5 5-5 5M20 12H10a6 6 0 0 0-6 6v1" />
    </StrokeIcon>
  );
}

// 画像を挿入: 写真フレーム + 「+」。画像検索 (フレーム+虫眼鏡) と絵で見分ける
export function ImageInsertIcon() {
  return (
    <StrokeIcon size="large">
      <rect {...TINT} x="3" y="4" width="13" height="13" rx="1" />
      <circle cx="7.5" cy="8.5" r="1.5" />
      <path d="M3 14l3.5-3.5L11 15" />
      <path d="M18 15v6M15 18h6" />
    </StrokeIcon>
  );
}

// クリップボードから取り込む: クリップボード + 中へ降りる矢印
// (docs/92-クリップボード連携計画.md §4)。メニューの CopyIcon (紙 2 枚の
// 重なり = コピー) とは別の形にして、取り出しと取り込みを絵で見分ける
export function PasteIcon() {
  return (
    <StrokeIcon size="large">
      <rect {...TINT} x="4" y="4" width="16" height="17" rx="2" />
      <rect x="9" y="2" width="6" height="4" rx="1" />
      <path d="M12 10v6M9 13.5l3 3 3-3" />
    </StrokeIcon>
  );
}

// 録音: マイク
export function MicIcon() {
  return (
    <StrokeIcon size="large">
      <rect {...TINT} x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
    </StrokeIcon>
  );
}

// 録画: ビデオカメラ (本体 + 三角の突き出し)
export function VideoIcon() {
  return (
    <StrokeIcon size="large">
      <rect {...TINT} x="3" y="6" width="12" height="12" rx="2" />
      <path d="M15 10l6-3v10l-6-3z" />
    </StrokeIcon>
  );
}

// お絵かき: 鉛筆
export function DrawIcon() {
  return (
    <StrokeIcon size="large">
      <path {...TINT} d="M4 20l1-4L16 5l3 3L8 19l-4 1z" />
      <path d="M14 7l3 3" />
    </StrokeIcon>
  );
}

// 画像を OCR: 画像フレーム + 文字を読み取る線。OCR は「画像から文字」なので
// フレームの中に文章の線を入れる
export function OcrIcon() {
  return (
    <StrokeIcon size="large">
      <rect {...TINT} x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9h10M7 12h10M7 15h6" />
    </StrokeIcon>
  );
}

// シークレット挿入: 南京錠。掛け金 (上の弧) と本体で「閉じている」を示す。
// 鍵 (KeyIcon) と紛らわしくならないよう、あちらは鍵そのもの、こちらは錠前
export function LockIcon() {
  return (
    <StrokeIcon size="large">
      <rect {...TINT} x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </StrokeIcon>
  );
}

// 書式メニュー (docs/70-編集ライブプレビュー計画.md §6)。
// 大文字の「A」に下線 — 文字に何かを掛ける、の一般的な絵
export function FormatIcon() {
  return (
    <StrokeIcon size="large">
      <path d="M5 15L10 5l5 10M6.5 12h7" />
      <path d="M4 20h16" />
    </StrokeIcon>
  );
}

// ライブプレビューの切り替え (docs/70-編集ライブプレビュー計画.md §4)。
// 「記法が装飾に変わる」ことを、大小 2 段の文字組み + 下線で表す。
// 目のアイコン (プレビュー) にしないのは、この画面では「閲覧に切り替える」
// (markdown タブ) と紛らわしいため — 切り替わるのは編集中の見え方だけ
export function LivePreviewIcon() {
  return (
    <StrokeIcon size="large">
      <path d="M4 8h7M4 12h7M4 16h4" />
      <path d="M15 16V8h2.5a2.5 2.5 0 0 1 0 5H15" />
    </StrokeIcon>
  );
}

// ノート内検索 (docs/76-ノート内検索計画.md §2)。虫眼鏡は検索画面の
// SearchIcon と同じ形で、下部バーの寸法 (24px) に拡大したもの — 同じ意味の
// 絵を 2 通り描かない。柄の向きも揃える (世の中の虫眼鏡がほぼこの向き)
export function FindIcon() {
  return (
    <StrokeIcon size="large">
      <circle {...TINT} cx="11" cy="11" r="6" />
      <path d="M15.5 15.5L21 21" />
    </StrokeIcon>
  );
}

// 以下、お絵かき画面のレイヤパネル (draw/DrawLayerPanel、docs/50-お絵かきレイヤ計画.md §4)
// のアイコン。暗い覆いの上に出すので、色は使う側 (ボタンの text-white) に従う。

// 目のアイコン (線画・currentColor。docs/31 の作法)。開いた目 / 斜線入りの目
export function EyeIcon({ hidden }: { hidden: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
      {hidden && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  );
}
