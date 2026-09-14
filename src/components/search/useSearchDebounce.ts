"use client";

import { useEffect, useRef, type CompositionEvent } from "react";

// 打ち終わりを待つ間隔。短すぎると 1 文字ごとに DB を引き、長いと反応が鈍い
const SEARCH_DEBOUNCE_MS = 300;

// 打ちながら検索する窓の「いつ引くか」(SearchForm)。
//
//   searchTyped … 打鍵ごと。打ち終わりを待ってから引く (打ち直すたびに前の予約は捨てる)
//   searchNow   … 送信・候補の確定・✕。待たずに引き、残っている予約も捨てる
//
// IME で変換中かどうかもここで持つ。変換中の打鍵は予約せず、
// compositionend で確定した値を予約し直す
export function useSearchDebounce(navigate: (query: string) => void) {
  // 打ち終わり待ちのタイマーと、IME で変換中かどうか。
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isComposing = useRef(false);

  useEffect(() => {
    return () => {
      if (searchTimer.current) {
        clearTimeout(searchTimer.current);
      }
    };
  }, []);

  // 打ち終わったら検索する。打ち直すたびに前の予約は捨てる
  const scheduleSearch = (value: string) => {
    if (searchTimer.current) {
      clearTimeout(searchTimer.current);
    }
    searchTimer.current = setTimeout(() => navigate(value), SEARCH_DEBOUNCE_MS);
  };

  const searchNow = (value: string) => {
    if (searchTimer.current) {
      clearTimeout(searchTimer.current);
      searchTimer.current = null;
    }
    navigate(value);
  };

  // IME の変換中は検索しない。確定前の文字で引いても意味がなく、
  // 変換候補を選ぶたびにサーバへ行くことになる (compositionend で拾う)
  const searchTyped = (value: string) => {
    if (!isComposing.current) {
      scheduleSearch(value);
    }
  };

  const compositionHandlers = {
    onCompositionStart: () => {
      isComposing.current = true;
    },
    onCompositionEnd: (e: CompositionEvent<HTMLInputElement>) => {
      isComposing.current = false;
      scheduleSearch(e.currentTarget.value);
    },
  };

  return { searchTyped, searchNow, compositionHandlers };
}
