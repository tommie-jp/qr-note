"use client";

import { useEffect, useRef, type RefObject } from "react";
import {
  insertTextOf,
  type Dropdown,
  type Suggestion,
} from "@/lib/search/suggest";
import { SAVED_LIMIT } from "@/lib/search/queries";

interface SuggestionListProps {
  dropdown: Dropdown;
  // 候補を真下に置く検索窓 (位置は窓から実測する)
  anchorRef: RefObject<HTMLInputElement | null>;
  onAccept: (s: Suggestion, dd: Dropdown) => void;
  onToggleSaved: (s: Suggestion, dd: Dropdown) => void;
  onShowMore: () => void;
}

// 候補一覧の置き場所 (docs/86 §4-13)。**fixed で出すために窓を実測する。**
// absolute のままだと 3 ペインの器 (main は overflow:hidden) に切られて
// 下半分が見えなくなる — 候補はペインの境界に関係なく全部見せたい。
// fixed は祖先の overflow に切られない (包含ブロックを作る祖先が無いことは
// 実測で確認済み) ので、窓の真下へ置き直せば足りる。
//
// **state ではなく DOM を直に置く。** 位置は React の外にある値 (窓の
// 実座標) で、state にすると測る → 描き直す → また測る の往復になる。
// ref コールバックは DOM に入った直後・描画の前に走るので、初期位置も
// ここで決まる (ちらつかない)
function placeList(el: HTMLUListElement | null, anchor: HTMLInputElement | null) {
  const box = anchor?.getBoundingClientRect();
  if (!el || !box) return;
  // mt-1 相当の 4px を空ける。左右と幅は窓に揃える
  el.style.left = `${box.left}px`;
  el.style.top = `${box.bottom + 4}px`;
  el.style.width = `${box.width}px`;
}

// 検索窓の候補ドロップダウン (docs/59-検索候補計画.md §1)。
// 開いている間だけ描かれる (SearchForm が dropdown の有無で出し分ける)
export function SuggestionList({
  dropdown,
  anchorRef,
  onAccept,
  onToggleSaved,
  onShowMore,
}: SuggestionListProps) {
  const listRef = useRef<HTMLUListElement | null>(null);

  // 開いている間は窓を追う。スクロール (capture で祖先の内側スクロールも
  // 拾う) と大きさの変化で窓が動くため。この部品は開いている間だけ
  // 描かれるので、張るのはマウント時・外すのはアンマウント時でよい
  useEffect(() => {
    const update = () => placeList(listRef.current, anchorRef.current);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [anchorRef]);

  const savedFull = dropdown.list?.savedFull ?? false;

  return (
    <ul
      id="search-suggestions"
      role="listbox"
      // **fixed で器の外へ出す** (docs/86 §4-13)。3 ペインでは器が
      // overflow:hidden なので、absolute のままだと候補の下半分が
      // 切られる。位置は placeList が窓から実測して入れる。
      // z-30 … ノートのペイン (z-0) と下部バー (z-10) より上。
      // max-h + overflow-y-auto … 候補が多いときに画面の外へ
      // 突き抜けないための保険 (SlotMenu と同じ作法)
      ref={(el) => {
        listRef.current = el;
        placeList(el, anchorRef.current);
      }}
      className="fixed z-30 max-h-[60vh] overflow-y-auto overscroll-contain rounded border border-gray-300 bg-white shadow-lg"
    >
      {dropdown.items.map((s, i) => (
        // key は値だけ。★/☆ を押すと kind が入れ替わるので、kind を
        // 混ぜると押した行が作り直されてしまう
        <SuggestionRow
          key={s.value}
          suggestion={s}
          isActive={i === dropdown.active}
          // 登録パターンと最近の検索の境目に線を引く。同じ見た目で
          // 続けると、固定の 3 件と入れ替わる 3 件が地続きに見える
          startsRecent={
            s.kind === "recent" && dropdown.items[i - 1]?.kind === "saved"
          }
          savedFull={savedFull}
          onAccept={() => onAccept(s, dropdown)}
          onToggleSaved={() => onToggleSaved(s, dropdown)}
        />
      ))}
      {/* 畳んでいる分を出す。listbox の option にはしない — 候補では
          なく操作なので、↑↓ で拾えると Enter で「検索」されてしまう。
          押しても窓は開いたままにしたいので mousedown で拾う
          (blur より先。★/☆ と同じ) */}
      {dropdown.list?.hasMore && (
        <li role="presentation" className="border-t border-gray-200">
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => {
              e.preventDefault();
              onShowMore();
            }}
            className="flex w-full items-center justify-center px-3 py-1 text-sm text-blue-600 hover:bg-gray-100"
          >
            もっと表示
          </button>
        </li>
      )}
    </ul>
  );
}

interface SuggestionRowProps {
  suggestion: Suggestion;
  isActive: boolean;
  // 最近の検索の 1 行目 (上に登録パターンがある)。境目の線を引く
  startsRecent: boolean;
  savedFull: boolean;
  onAccept: () => void;
  onToggleSaved: () => void;
}

function SuggestionRow({
  suggestion: s,
  isActive,
  startsRecent,
  savedFull,
  onAccept,
  onToggleSaved,
}: SuggestionRowProps) {
  return (
    <li
      role="option"
      aria-selected={isActive}
      // blur より先に確定するため mousedown で拾う。
      onMouseDown={(e) => {
        e.preventDefault();
        onAccept();
      }}
      // 行の高さは本文の 1 行ぶん (py-0.5 + text-sm の行送り ≒ 24px。
      // docs/86 §4-13)。40px のタップ目標は取らない — 候補は
      // 1 画面にいくつ並ぶかがそのまま使い勝手になる場所で、
      // フォルダーペインの行と同じ判断
      className={`flex cursor-pointer items-center gap-2 px-3 py-0.5 text-sm ${
        startsRecent ? "border-t border-gray-200" : ""
      } ${
        isActive ? "bg-blue-600 text-white" : "text-gray-700 hover:bg-gray-100"
      }`}
    >
      <span className="flex-1 truncate">
        {s.kind === "recent" && (
          <span aria-hidden className="mr-1.5 opacity-60">
            🕐
          </span>
        )}
        {insertTextOf(s)}
      </span>
      {/* ☆/★ で登録パターンに入れる・外す。listbox の option に
          ボタンを入れるのは ARIA 的には行儀が悪いが、行そのものは
          mousedown で確定できるまま、キーボード操作も listbox の
          ものが生きる。tabIndex=-1 で Tab の巡回からは外す
          (Tab は補完に使う) */}
      {(s.kind === "saved" || s.kind === "recent") && (
        <button
          type="button"
          tabIndex={-1}
          // 満杯のときは押せなくする。黙って何も起きないと
          // 「登録したつもり」になるため、理由を title に出す
          disabled={s.kind === "recent" && savedFull}
          aria-label={
            s.kind === "saved"
              ? `「${s.value}」を登録パターンから外す`
              : `「${s.value}」を登録パターンにする`
          }
          title={
            s.kind === "saved"
              ? "登録パターンから外す"
              : savedFull
                ? `登録は ${SAVED_LIMIT} 件まで (★ を押して外す)`
                : "登録する"
          }
          // 行の確定 (li の mousedown) へ伝わらないよう止める
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleSaved();
          }}
          className="-mr-1 flex size-6 shrink-0 items-center justify-center rounded text-amber-500 hover:bg-black/10 disabled:opacity-30 disabled:hover:bg-transparent"
        >
          {s.kind === "saved" ? "★" : "☆"}
        </button>
      )}
    </li>
  );
}
