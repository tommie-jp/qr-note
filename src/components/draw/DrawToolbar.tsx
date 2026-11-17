"use client";

// お絵かきの道具立て (docs/34-お絵かき計画.md §2)。
// 暗い覆いの上に置くので、共有の SECONDARY_BUTTON_CLASS (白地) ではなく
// この画面だけの配色を持つ。狭い端末でも畳まず、はみ出した分は横に流す。

import { DRAW_WIDTH_OPTIONS } from "@/lib/draw/drawPrefs";
import type { DrawTool } from "./drawTools";

const TOOLS: ReadonlyArray<{ id: DrawTool; label: string }> = [
  { id: "pen", label: "ペン" },
  { id: "marker", label: "マーカー" },
  { id: "fill", label: "塗る" },
  { id: "arrow", label: "矢印" },
  { id: "rect", label: "四角" },
  { id: "ellipse", label: "丸" },
  { id: "mosaic", label: "モザイク" },
  { id: "eraser", label: "消しゴム" },
  { id: "select", label: "選択" },
  { id: "text", label: "文字" },
  { id: "pan", label: "移動" },
];

// 太さが効かない道具では、選択肢を出しても迷わせるだけなので伏せる
const WIDTH_TOOLS: ReadonlySet<DrawTool> = new Set<DrawTool>([
  "pen",
  "marker",
  "eraser",
  "arrow",
  "rect",
  "ellipse",
  "text",
]);

// 色が効かない道具 (消す・隠す・動かす・選ぶ) も同じ
const COLOR_TOOLS: ReadonlySet<DrawTool> = new Set<DrawTool>([
  "pen",
  "marker",
  "fill",
  "arrow",
  "rect",
  "ellipse",
  "text",
]);

// 44px 四方を確保する (指で狙う場所なので詰めない)。
// 選んでいる道具は青、それ以外は白抜き — 別々のクラスにして、
// Tailwind の定義順で背景色が競合しないようにする (src/components/ui.ts 参照)
const BUTTON_BASE =
  "inline-flex min-h-11 shrink-0 items-center justify-center rounded px-3 font-medium transition active:scale-95 disabled:opacity-40 disabled:active:scale-100";
const BUTTON_ON = `${BUTTON_BASE} bg-blue-600 text-white`;
const BUTTON_OFF = `${BUTTON_BASE} bg-white/15 text-white hover:bg-white/25`;
const BUTTON_DANGER = `${BUTTON_BASE} bg-red-600/80 text-white hover:bg-red-600`;

export interface DrawToolbarProps {
  tool: DrawTool;
  onTool: (tool: DrawTool) => void;
  color: string;
  onColor: (color: string) => void;
  width: number;
  onWidth: (width: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  disabled: boolean;
  zoom: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
}

// 道具の切り替え。選んでいる道具は aria-pressed と青で示す
function ToolButtons({
  tool,
  onTool,
  disabled,
}: Pick<DrawToolbarProps, "tool" | "onTool" | "disabled">) {
  return (
    <>
      {TOOLS.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onTool(item.id)}
          disabled={disabled}
          aria-pressed={tool === item.id}
          className={tool === item.id ? BUTTON_ON : BUTTON_OFF}
        >
          {item.label}
        </button>
      ))}
    </>
  );
}

// 色と太さ。効かない道具では押せなくする (COLOR_TOOLS・WIDTH_TOOLS)
function StyleControls({
  tool,
  color,
  onColor,
  width,
  onWidth,
  disabled,
}: Pick<DrawToolbarProps, "tool" | "color" | "onColor" | "width" | "onWidth" | "disabled">) {
  return (
    <>
      <input
        type="color"
        value={color}
        onChange={(event) => onColor(event.target.value)}
        disabled={disabled || !COLOR_TOOLS.has(tool)}
        aria-label="色"
        title="色"
        className="size-11 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
      />
      <select
        value={width}
        onChange={(event) => onWidth(Number(event.target.value))}
        disabled={disabled || !WIDTH_TOOLS.has(tool)}
        aria-label="太さ"
        title="太さ"
        className={`${BUTTON_OFF} appearance-none`}
      >
        {DRAW_WIDTH_OPTIONS.map((option) => (
          <option key={option} value={option} className="text-gray-900">
            太さ {option}
          </option>
        ))}
      </select>
    </>
  );
}

function HistoryButtons({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClear,
  disabled,
}: Pick<DrawToolbarProps, "canUndo" | "canRedo" | "onUndo" | "onRedo" | "onClear" | "disabled">) {
  return (
    <>
      <button type="button" onClick={onUndo} disabled={disabled || !canUndo} className={BUTTON_OFF}>
        元に戻す
      </button>
      <button type="button" onClick={onRedo} disabled={disabled || !canRedo} className={BUTTON_OFF}>
        やり直す
      </button>
      <button type="button" onClick={onClear} disabled={disabled} className={BUTTON_DANGER}>
        全消し
      </button>
    </>
  );
}

type ZoomButtonsProps = Pick<
  DrawToolbarProps,
  "zoom" | "canZoomIn" | "canZoomOut" | "onZoomIn" | "onZoomOut" | "onZoomReset" | "disabled"
>;

// 拡大は「移動」道具でのピンチでも変えられる。ボタンは指の無い
// 環境と、倍率を戻す手立てのために置く (docs/36 §4)
function ZoomButtons({
  zoom,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  disabled,
}: ZoomButtonsProps) {
  return (
    <>
      <button
        type="button"
        onClick={onZoomOut}
        disabled={disabled || !canZoomOut}
        aria-label="縮小"
        title="縮小"
        className={BUTTON_OFF}
      >
        −
      </button>
      <button
        type="button"
        onClick={onZoomReset}
        disabled={disabled || zoom === 1}
        aria-label="全体を表示"
        title="全体を表示"
        className={BUTTON_OFF}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        onClick={onZoomIn}
        disabled={disabled || !canZoomIn}
        aria-label="拡大"
        title="拡大"
        className={BUTTON_OFF}
      >
        ＋
      </button>
    </>
  );
}

export function DrawToolbar(props: DrawToolbarProps) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto px-3 py-2 text-sm">
      <ToolButtons {...props} />
      <StyleControls {...props} />
      <HistoryButtons {...props} />
      <ZoomButtons {...props} />
    </div>
  );
}
