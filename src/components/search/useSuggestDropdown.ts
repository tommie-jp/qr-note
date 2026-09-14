"use client";

import { useState, type KeyboardEvent } from "react";
import type { Completion } from "@/lib/search/queryComplete";
import {
  listDropdown,
  moveActive,
  reflectSavedLists,
  suggestDropdown,
  tabAction,
  withSavedFull,
  type Dropdown,
  type Suggestion,
} from "@/lib/search/suggest";
import type { QueryLists } from "@/lib/search/queries";

interface SuggestDropdownOptions {
  tags: string[];
  // 候補の元。null = まだ読めていない (useSavedQueries)
  lists: QueryLists | null;
  // 窓の今の値と、窓にフォーカスがあるか (SearchForm が持つ)
  query: string;
  isFocused: boolean;
}

// キーで確定・補完したときに、窓の値を書き換える手 (SearchForm が持つ)
export interface SuggestKeyActions {
  // 候補を確定する (Enter・候補が 1 つだけの Tab)
  accept: (s: Suggestion, dd: Dropdown) => void;
  // Tab で打ちかけの語を最長共通プレフィックスまで伸ばした
  extend: (completion: Completion) => void;
}

// 検索窓の候補ドロップダウンの開閉と選択 (docs/59-検索候補計画.md §1)。
// 何を出すかの判断は lib/search/suggest.ts の純関数、描画は SuggestionList。
export function useSuggestDropdown({
  tags,
  lists,
  query,
  isFocused,
}: SuggestDropdownOptions) {
  const [dropdown, setDropdown] = useState<Dropdown | null>(null);
  // Escape で候補を閉じたか。閉じた後にサーバの取得が届いても開き直さない
  const [dismissed, setDismissed] = useState(false);

  // サーバから候補が届いたとき。
  //
  // **開いている一覧は組み直さない** — 並びが指の下で動くと、続けて押した指が
  // 隣の検索語を登録してしまう (下の reflectSaved と同じ理由)。閉じているときだけ
  // 開く = 「読めていなくて出せなかった」を後から拾う。開いている場合の新しい
  // 値は、次に開いたときに使われる
  //
  // Escape で閉じた後は開き直さない。**閉じたのに勝手に開く**のがいちばん
  // 困る形で、フォーカスしたときの取得はまだ飛んでいるので必ず後から届く
  const [syncedLists, setSyncedLists] = useState(lists);
  if (lists !== syncedLists) {
    setSyncedLists(lists);
    if (dropdown === null && isFocused && !dismissed && query.trim() === "") {
      setDropdown(listDropdown(lists));
    }
  }

  // 現在の値とキャレット位置から出すべき候補を決める (docs/59 §1)。
  const refresh = (value: string, caret: number) => {
    // 打つ・押す・フォーカスし直すのはどれも「また出してよい」の合図。
    // Escape で閉じたことは、ここでご破算にする
    setDismissed(false);
    setDropdown(suggestDropdown(value, caret, tags, lists));
  };

  // 登録パターンと最近の検索の一覧を出す (✕ で消した直後・「もっと表示」)
  const showList = (expanded = false) => {
    setDropdown(listDropdown(lists, expanded));
  };

  const close = () => {
    setDropdown(null);
  };

  // ☆ を押したら満杯だった。押せない見た目へ直す
  const markSavedFull = (dd: Dropdown) => {
    setDropdown(withSavedFull(dd));
  };

  // 押した後もドロップダウンは開いたままにするが、**行の並びは動かさない**。
  // 登録した行を ★ の欄へ移すと下の行が 1 つずつ繰り上がり、続けて押した指が
  // 隣の検索語を登録してしまう。★/☆ と 🕐 が切り替わるだけで合図は足りるので、
  // 並べ直すのは次に開いたときでよい
  const reflectSaved = (dd: Dropdown, next: QueryLists) => {
    setDropdown(reflectSavedLists(dd, next));
  };

  const handleKeyDown = (
    e: KeyboardEvent<HTMLInputElement>,
    actions: SuggestKeyActions,
  ) => {
    // IME 変換中 (日本語入力) のキーは補完に横取りしない。
    if (e.nativeEvent.isComposing) return;
    if (!dropdown) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setDropdown(moveActive(dropdown, 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setDropdown(moveActive(dropdown, -1));
        break;
      case "Enter":
        // 候補を選択中のときだけ確定。未選択なら送信を妨げない。
        if (dropdown.active >= 0) {
          e.preventDefault();
          actions.accept(dropdown.items[dropdown.active], dropdown);
        }
        break;
      case "Tab": {
        const action = tabAction(query, dropdown);
        if (action.kind === "ignore") break;
        e.preventDefault();
        if (action.kind === "accept") {
          actions.accept(action.suggestion, dropdown);
        } else if (action.kind === "extend") {
          actions.extend(action.completion);
          refresh(action.completion.query, action.completion.cursor);
        }
        break;
      }
      case "Escape":
        e.preventDefault();
        setDropdown(null);
        setDismissed(true);
        break;
    }
  };

  return {
    dropdown,
    refresh,
    showList,
    close,
    markSavedFull,
    reflectSaved,
    handleKeyDown,
  };
}
