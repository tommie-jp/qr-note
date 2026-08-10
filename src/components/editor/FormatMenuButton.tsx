"use client";

import { useRef, useState } from "react";
import { SlotMenu } from "@/components/SlotMenu";
import { SLOT_MENU_ITEM_CLASS } from "@/components/ui";
import { FormatIcon } from "@/components/MenuIcons";
import type { FormatAction } from "./markdownFormat";

// 下部バーの「書式」ボタン (docs/70-編集ライブプレビュー計画.md §6)。
// 押すとメニューが開き、選んだ書式を本文の選択範囲に掛ける。
//
// **ボタン 1 つ + メニュー**にしたのは、帯が既に 10 個で満杯だから。
// 書式を 6 つ並べると、いま並んでいる挿入系のボタンがスクロールの奥へ
// 押しやられる。長押しではなくタップで開くのは、このボタン自身には
// 「押したときの既定の動作」が無いため (下部バーのスロットは短いタップで
// 値が循環するので、そちらは長押しに割り当ててある。docs/62 §2)。
//
// メニューの中身と閉じ方は下部バーの流儀をそのまま使う (SlotMenu)。
// 選んだあと即座に閉じてよい — BarSlot が閉じるのを遅らせているのは、
// 行がフォームの submit ボタンで送信が後から走るためで、ここは
// その場で CodeMirror に反映される普通のボタン。
//
// **overflow を持つ入れ物の中に置かないこと。** メニューは absolute で
// ボタンの上端より上へ開く。CSS の規定で overflow-x だけを auto にすると
// overflow-y も visible ではなくなるため、横スクロールの帯 (EditToolbar の
// ツール列) の中に置くとメニューが切り取られ、押しても何も出ないように
// 見える。これで一度実機で出ているので、置き場所を動かすときは注意。

interface FormatMenuItem {
  action: FormatAction;
  label: string;
  // 記法そのものを見せる。「太字」より `**` のほうが、掛かるものが判る
  sample: string;
}

// **2 段に分ける。** 上は選択範囲や行に掛ける付け外し、下は雛形の差し込み。
// 押したときの振る舞いが違う (下は押すたびに増える) ので、混ぜると
// 「もう一度押せば戻る」と思って二重に入れてしまう
const TOGGLE_ITEMS: readonly FormatMenuItem[] = [
  { action: "heading", label: "見出し", sample: "#" },
  { action: "bold", label: "太字", sample: "**" },
  { action: "bullet", label: "箇条書き", sample: "-" },
  { action: "task", label: "チェックボックス", sample: "- [ ]" },
  { action: "quote", label: "引用", sample: ">" },
  { action: "code", label: "コード", sample: "`" },
  { action: "math", label: "数式", sample: "$" },
];

// 差し込むもの。**ライブプレビューが図として描けるもの**を並べる
// (docs/70 §7) — 表・別行の数式・図・回路図・問題。記法を覚えていなくても
// 骨組みが入るので、スマホでも書き始められる
const INSERT_ITEMS: readonly FormatMenuItem[] = [
  { action: "table", label: "表", sample: "| |" },
  { action: "mathBlock", label: "別行の数式", sample: "$$" },
  { action: "mermaid", label: "図", sample: "mermaid" },
  { action: "circuit", label: "回路図", sample: "circuitikz" },
  { action: "quiz", label: "問題", sample: "quiz" },
];

// メニューの 1 行。記法の見本とラベルを並べる
function MenuRow({
  item,
  onSelect,
}: {
  item: FormatMenuItem;
  onSelect: (action: FormatAction) => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => onSelect(item.action)}
      className={SLOT_MENU_ITEM_CLASS}
    >
      {/* 記法は等幅で桁を揃える。文字数が違う (`#` と `circuitikz`) ので、
          幅を決めておかないとラベルの左端が行ごとにずれる */}
      <span
        aria-hidden
        className="w-20 shrink-0 truncate font-mono text-xs text-gray-400"
      >
        {item.sample}
      </span>
      {item.label}
    </button>
  );
}

interface FormatMenuButtonProps {
  onFormat: (action: FormatAction) => void;
  className: string;
}

export function FormatMenuButton({ onFormat, className }: FormatMenuButtonProps) {
  const [open, setOpen] = useState(false);
  // SlotMenu が「外側の押下」からこのボタンを除くのに使う
  const buttonRef = useRef<HTMLButtonElement>(null);

  const select = (action: FormatAction) => {
    setOpen(false);
    onFormat(action);
  };

  return (
    // relative … メニュー (absolute) の基準。帯の項目は shrink-0 なので、
    // ここも縮ませない (縮むとメニューの中心がボタンからずれる)
    <div className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className={className}
      >
        <span className="flex text-indigo-600">
          <FormatIcon />
        </span>
        書式
      </button>
      {/* メニューは**ボタンより後ろ**に置く。absolute なので見た目の位置は
          変わらないが、DOM の並びがそのままタブ順になるため、前に置くと
          開いた項目へ Shift+Tab でしか入れない (BarSlot と同じ) */}
      {open && (
        <SlotMenu
          label="書式"
          anchorRef={buttonRef}
          onClose={() => setOpen(false)}
          // ボタンの左端を軸に右へ開く。中心を軸にすると、帯の左寄りに
          // あるこのボタンでは画面の左外へはみ出して見本の記法が切れる
          align="start"
        >
          {TOGGLE_ITEMS.map((item) => (
            <MenuRow key={item.action} item={item} onSelect={select} />
          ))}
          {/* 付け外しと差し込みの境目。見出しの文字は置かない — 3 段目の
              行が増えるだけで、記法の見本を見れば違いは判る */}
          <hr aria-hidden className="my-1 border-gray-200" />
          {INSERT_ITEMS.map((item) => (
            <MenuRow key={item.action} item={item} onSelect={select} />
          ))}
        </SlotMenu>
      )}
    </div>
  );
}
