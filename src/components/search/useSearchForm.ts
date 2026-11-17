"use client";

import {
  type ChangeEvent,
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import { useKeyboardDismissOnScroll } from "@/components/hooks/useKeyboardDismissOnScroll";
import { useSavedQueries } from "@/components/search/useSavedQueries";
import { useSearchDebounce } from "@/components/search/useSearchDebounce";
import {
  type SuggestKeyActions,
  useSuggestDropdown,
} from "@/components/search/useSuggestDropdown";
import { useSearchNav } from "@/components/search/SearchNav";
import { replaceRange, type Completion } from "@/lib/search/queryComplete";
import { insertTextOf, type Dropdown, type Suggestion } from "@/lib/search/suggest";
import { recordQueryUse } from "@/lib/search/queryClient";

// 検索窓 (SearchForm) の値・キャレット・フォーカスと、それを繋ぐ手

// 窓の値・フォーカス・候補・検索の引き方をまとめて持つ
function useSearchFormState(initialQuery: string, tags: string[], isDemo: boolean) {
  const { navigate } = useSearchNav();
  const params = useSearchParams();
  const [query, setQuery] = useState(initialQuery);
  // 入力中かどうか (URL の反映を止める判断に使う)
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // 補完適用後にキャレット位置を復元するための保留値。
  const pendingCaret = useRef<number | null>(null);

  const { searchTyped, searchNow, compositionHandlers } =
    useSearchDebounce(navigate);
  const { lists, reloadLists, toggleSaved: toggleSavedQuery } =
    useSavedQueries(isDemo);
  const suggest = useSuggestDropdown({ tags, lists, query, isFocused });

  useEffect(() => {
    if (pendingCaret.current !== null && inputRef.current) {
      const pos = pendingCaret.current;
      inputRef.current.setSelectionRange(pos, pos);
      pendingCaret.current = null;
    }
  });

  // 結果をスクロールし始めたらキーボードを閉じる (docs/31-下部操作バー計画.md §8-3)。
  // 入力欄の中 (フォーム) で始まった指の動きは文字列選択なので閉じない
  useKeyboardDismissOnScroll(isFocused, formRef, inputRef);

  useSyncQueryFromUrl(initialQuery, isFocused, setQuery, suggest.close);

  return {
    params,
    query,
    setQuery,
    setIsFocused,
    inputRef,
    formRef,
    pendingCaret,
    searchTyped,
    searchNow,
    compositionHandlers,
    reloadLists,
    toggleSavedQuery,
    suggest,
  };
}

type SearchFormState = ReturnType<typeof useSearchFormState>;

// URL の検索語が外から変わったら窓も合わせる (スキャン・タグリンク・戻る)。
// 入力中 (窓にフォーカスがある) は反映しない: 自分が投げた検索の結果が返る頃には
// 続きを打っていることがあり、URL で上書きすると打った文字が消えるため。
// フォーカスがなければ URL が正で、打ち終わった後は最後の応答に必ず追いつく
function useSyncQueryFromUrl(
  initialQuery: string,
  isFocused: boolean,
  setQuery: (query: string) => void,
  closeSuggest: () => void,
) {
  const [syncedQuery, setSyncedQuery] = useState(initialQuery);
  if (initialQuery !== syncedQuery) {
    setSyncedQuery(initialQuery);
    if (!isFocused) {
      setQuery(initialQuery);
      closeSuggest();
    }
  }
}

type FormParts<K extends keyof SearchFormState> = Pick<SearchFormState, K>;

// 検索窓の状態と操作を組んで、描画に要る物だけを返す
export function useSearchForm(initialQuery: string, tags: string[], isDemo: boolean) {
  const {
    params,
    query,
    setQuery,
    setIsFocused,
    inputRef,
    formRef,
    pendingCaret,
    searchTyped,
    searchNow,
    compositionHandlers,
    reloadLists,
    toggleSavedQuery,
    suggest,
  } = useSearchFormState(initialQuery, tags, isDemo);
  const { accept, extend } = useSuggestHandlers({ query, setQuery, inputRef, pendingCaret, searchNow, suggest });
  const toggleSaved = useToggleSaved({ inputRef, toggleSavedQuery, suggest });
  const handlers = {
    ...useInputHandlers(
      { setQuery, setIsFocused, inputRef, searchTyped, reloadLists, suggest },
      { accept, extend },
    ),
    ...useClearAndSubmit({ query, setQuery, inputRef, searchNow, suggest }),
  };
  return {
    params,
    query,
    formRef,
    inputRef,
    compositionHandlers,
    dropdown: suggest.dropdown,
    handlers,
    suggestHandlers: { accept, toggleSaved },
  };
}

// 候補の行から来る操作 (確定・Tab で伸ばす)
function useSuggestHandlers({
  query,
  setQuery,
  inputRef,
  pendingCaret,
  searchNow,
  suggest,
}: FormParts<"query" | "setQuery" | "inputRef" | "pendingCaret" | "searchNow" | "suggest">) {
  // 候補を確定して入力へ反映する。
  //
  // 候補を選ぶのはどれも検索の意思表示なので、debounce を待たずに引き、
  // 同時に最近の検索へ記録する (docs/59-検索候補計画.md §2)。
  const accept = (s: Suggestion, dd: Dropdown) => {
    if (dd.token) {
      // 補完 … 打ちかけのトークンだけを置き換え、続きを打てるよう窓に残る
      const { query: next, cursor } = replaceRange(
        query,
        dd.token.range,
        insertTextOf(s),
        { addSpace: true },
      );
      setQuery(next);
      pendingCaret.current = cursor;
      suggest.close();
      inputRef.current?.focus();
      recordQueryUse(next);
      searchNow(next);
      return;
    }
    // パターン・最近 … クエリ全体を差し替える。結果を見に行く操作なので
    // 送信と同じくキーボードを閉じる
    setQuery(s.value);
    suggest.close();
    inputRef.current?.blur();
    recordQueryUse(s.value);
    searchNow(s.value);
  };

  // Tab で打ちかけの語を伸ばした。候補の組み直しは useSuggestDropdown がする
  const extend = ({ query: next, cursor }: Completion) => {
    setQuery(next);
    pendingCaret.current = cursor;
  };

  return { accept, extend };
}

// 候補の行を登録パターンに入れる / 外す (docs/59-検索候補計画.md §4)。
function useToggleSaved({
  inputRef,
  toggleSavedQuery,
  suggest,
}: FormParts<"inputRef" | "toggleSavedQuery" | "suggest">) {
  return (s: Suggestion, dd: Dropdown) => {
    const result = toggleSavedQuery(s);
    if (result.status === "unloaded") {
      return; // まだ読めていない。知らない物へ書き戻さない
    }
    if (result.status === "full") {
      // 満杯。**黙って何も起きないのがいちばん困る** (登録したつもりになる)
      // ので、押せない見た目へ直して理由を出す (☆ の title)
      suggest.markSavedFull(dd);
      return;
    }
    suggest.reflectSaved(dd, result.lists);
    inputRef.current?.focus();
  };
}

// 窓そのものの操作 (打鍵・キー・押す・焦点・もっと見る)
function useInputHandlers(
  {
    setQuery,
    setIsFocused,
    inputRef,
    searchTyped,
    reloadLists,
    suggest,
  }: FormParts<"setQuery" | "setIsFocused" | "inputRef" | "searchTyped" | "reloadLists" | "suggest">,
  keyActions: SuggestKeyActions,
) {
  return {
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setQuery(value);
      suggest.refresh(value, e.target.selectionStart ?? value.length);
      searchTyped(value);
    },
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => suggest.handleKeyDown(e, keyActions),
    onClick: (e: MouseEvent<HTMLInputElement>) =>
      suggest.refresh(e.currentTarget.value, e.currentTarget.selectionStart ?? 0),
    // フォーカスしただけで候補を出す。窓が空なら登録パターンと
    // 最近の検索、打ちかけならその続き (docs/59-検索候補計画.md §1)
    onFocus: (e: FocusEvent<HTMLInputElement>) => {
      setIsFocused(true);
      // 候補はここで初めて要る値なので、読むのもここ 1 回きりでよい
      // (描画のたびには引かない。docs/59-検索候補計画.md §7)
      reloadLists();
      suggest.refresh(e.currentTarget.value, e.currentTarget.selectionStart ?? 0);
    },
    onBlur: () => {
      setIsFocused(false);
      suggest.close();
    },
    onShowMore: () => {
      suggest.showList(true);
      inputRef.current?.focus();
    },
  };
}

// ✕ で消す・送信する
function useClearAndSubmit({
  query,
  setQuery,
  inputRef,
  searchNow,
  suggest,
}: FormParts<"query" | "setQuery" | "inputRef" | "searchNow" | "suggest">) {
  return {
    onClear: () => {
      // **フォーカスを先に戻す。** 窓から外れていた場合 (結果を
      // スクロールするとキーボードを閉じるため blur する) は
      // focus() が onFocus を同期で走らせ、その中の refresh が
      // **まだ古い値が入っている DOM** を読んで候補を組み直す。
      // 後に回すと、こちらで出した一覧をそれが上書きしてしまう
      inputRef.current?.focus();
      setQuery("");
      suggest.showList();
      searchNow("");
    },
    // JS が動くならクライアント遷移で結果だけ差し替える (全体の再読込を避ける)。
    // JS 無効なら preventDefault が走らず、素の GET フォームとして今までどおり動く
    onSubmit: (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      // 明示的な送信は「これで探したい」の合図なので記録する。
      // 打鍵ごとの検索 (searchTyped) では記録しない — 打ちかけの語が並ぶため
      recordQueryUse(query);
      searchNow(query);
      // モバイルでキーボードを閉じて結果を見せる
      inputRef.current?.blur();
    },
  };
}

export type SearchFormView = ReturnType<typeof useSearchForm>;
