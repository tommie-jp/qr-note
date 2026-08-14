import type { ReactNode } from "react";

// 一覧のノート全体プレビューの縮小枠 (docs/71-一覧ノートプレビュー計画.md §2)。
//
// 中身 (NotePreviewThumb) はサーバが描いた ReactNode で、ここは仮想キャンバスを
// サムネ枠へ縮める箱だけを持つ。ItemRow (client 束にも入る) から import
// されるので、react-markdown などの重い依存をここに足さないこと。
//
// **3 つの値は 1 つの組にして持つ** — キャンバス・縮小率・枠は
// 「canvas × scale = frame」で釣り合っていないと、中身が枠からはみ出すか
// 余白が空く。別々の表に散らすと片方だけ直したときに黙ってずれる
// (画像サムネの THUMB_SIZE_CLASS とは独立にここで完結させる理由)。
// 比は rem どうしなので、文字サイズ設定 (docs/61) で root が伸縮しても崩れない。
//
//   compact … 10rem × 0.25 = 2.5rem (size-10)。40px では文字は模様にしかならず、
//             キャンバスを小さくしたほうが「何かが書いてある」感が残る
//   card    … 20rem × 0.3  = 6rem   (size-24)。見出しや図の形が判る
const FRAME: Record<
  "compact" | "medium" | "card",
  { canvas: string; scale: string; frame: string }
> = {
  compact: { canvas: "h-40 w-40", scale: "scale-[0.15]", frame: "size-6" },
  medium: { canvas: "h-40 w-40", scale: "scale-[0.25]", frame: "size-10" },
  card: { canvas: "h-80 w-80", scale: "scale-[0.3]", frame: "size-24" },
};

interface NotePreviewFrameProps {
  view: "compact" | "medium" | "card";
  children: ReactNode;
}

// aria-hidden … 装飾扱い (RowThumb の alt="" / CircuitThumb と同じ理屈)。
// inert + pointer-events-none … 中身は本文の縮小描画で、リンク風の文字や
// チェックボックスの絵が入る。押せる物は描いていない (NotePreviewThumb の
// 差し替えが正本) が、フォーカス・選択・クリックの経路ごと塞いで二重に守る
// (inert は古い iOS Safari に無いので pointer-events-none も残す)
export function NotePreviewFrame({ view, children }: NotePreviewFrameProps) {
  const { canvas, scale, frame } = FRAME[view];
  return (
    <div
      aria-hidden
      inert
      className={`note-preview ${frame} pointer-events-none shrink-0 self-center overflow-hidden rounded border border-gray-200 bg-white`}
    >
      <div className={`${canvas} origin-top-left overflow-hidden ${scale}`}>
        {children}
      </div>
    </div>
  );
}
