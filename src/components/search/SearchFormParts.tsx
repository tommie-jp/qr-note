"use client";

import type { RefObject } from "react";
import type { ReadonlyURLSearchParams } from "next/navigation";
import { PlusIcon, SearchIcon } from "@/components/icons";
import { PendingLink } from "@/components/chrome/PendingLink";
import { SearchClearButton } from "@/components/search/SearchClearButton";
import { SuggestionList } from "@/components/search/SuggestionList";
import {
  COMPACT_ICON_BUTTON_CLASS,
  COMPACT_INPUT_CLASS,
  COMPACT_PRIMARY_ICON_BUTTON_CLASS,
} from "@/components/ui";
import type { Dropdown } from "@/lib/search/suggest";
import { navigate as navigateTo } from "@/lib/client/navigation";
import type { ResultView } from "@/modules/registry";
import type { SearchFormView } from "./useSearchForm";

// 検索窓 (SearchForm) の表示部品

interface SearchInputBoxProps {
  query: string;
  dropdown: Dropdown | null;
  inputRef: RefObject<HTMLInputElement | null>;
  handlers: SearchFormView["handlers"];
  suggestHandlers: SearchFormView["suggestHandlers"];
  compositionHandlers: SearchFormView["compositionHandlers"];
}

// 入力窓と、右端に重ねる ✕・候補の一覧
export function SearchInputBox({
  query,
  dropdown,
  inputRef,
  handlers,
  suggestHandlers,
  compositionHandlers,
}: SearchInputBoxProps) {
  return (
    /* min-w-[10rem] ではなく px で持つ。テキストサイズ (docs/61) は root の
       font-size を動かすので、rem の下限は倍率ぶん広がり、200% では窓だけで
       320px を要求して画面ごと横スクロールになる。窓の中の文字は倍率どおり
       大きくなるので、器の下限まで一緒に広げる必要はない */
    <div className="relative min-w-[160px] flex-1">
      <SearchQueryInput
        query={query}
        expanded={dropdown !== null}
        inputRef={inputRef}
        handlers={handlers}
        compositionHandlers={compositionHandlers}
      />
      {/* 空のときは ✕ を出さない — 消す物が無いのに押せる的があると、
          押してから何も起きないことに気づく */}
      {query !== "" && <SearchClearButton onClear={handlers.onClear} />}
      {dropdown && (
        <SuggestionList
          dropdown={dropdown}
          anchorRef={inputRef}
          onAccept={suggestHandlers.accept}
          onToggleSaved={suggestHandlers.toggleSaved}
          onShowMore={handlers.onShowMore}
        />
      )}
    </div>
  );
}

function SearchQueryInput({
  query,
  expanded,
  inputRef,
  handlers,
  compositionHandlers,
}: Pick<SearchInputBoxProps, "query" | "inputRef" | "handlers" | "compositionHandlers"> & {
  expanded: boolean;
}) {
  return (
    <input
      ref={inputRef}
      type="search"
      name="q"
      value={query}
      onChange={handlers.onChange}
      onKeyDown={handlers.onKeyDown}
      {...compositionHandlers}
      onClick={handlers.onClick}
      onFocus={handlers.onFocus}
      onBlur={handlers.onBlur}
      placeholder="部品番号・メモ・URL を全文検索（スペースで AND、|で OR、#でタグ）"
      autoComplete="off"
      role="combobox"
      aria-expanded={expanded}
      aria-autocomplete="list"
      aria-controls="search-suggestions"
      // pr-9 … 右端に重ねる ✕ のぶんを空ける。空けないと長い検索語の
      // 末尾が ✕ の下へ潜る。**空でも空けたままにする** — 出たり
      // 消えたりで文字が横に跳ねるほうが目に付く。
      // [&::-webkit-search-cancel-button]:hidden … 標準の ✕ を消す。
      // 消さないと Windows の Chrome/Edge だけ ✕ が 2 つ並ぶ
      className={`w-full pr-9 ${COMPACT_INPUT_CLASS} [&::-webkit-search-cancel-button]:hidden`}
    />
  );
}

// ボタンは 1 つの塊にまとめる。塊にしないと狭い画面で
// 「検索だけ入力窓と同じ行に残る」散らかった並びになる。
// スキャン・画像検索は下部バーへ移したので残りは 2 つ
// (docs/31-下部操作バー計画.md §2)
export function SearchFormButtons({
  activeView,
  params,
}: {
  activeView: ResultView | null;
  params: ReadonlyURLSearchParams;
}) {
  return (
    <div className="flex gap-1.5">
      {/* 打つそばから検索するので普段は押さなくてよいが、JS 無効時の唯一の
          検索手段であり、確定の合図としても残す。
          「検索」の文字をやめて虫眼鏡にする (docs/62 §5)。窓の中身が何か、
          隣に何があるかから用途は明らかで、狭い画面ではその 2 文字ぶんが
          そのまま入力欄の幅になる。意味は aria-label / title で補う */}
      <button
        type="submit"
        aria-label="検索"
        title="検索"
        className={COMPACT_PRIMARY_ICON_BUTTON_CLASS}
      >
        <SearchIcon />
      </button>
      <NewItemButton activeView={activeView} params={params} />
    </div>
  );
}

// 空ノートを作る (docs/27-新規ノート追加計画.md)。
// 遷移先の /new は押した瞬間に採番して /edit/<番号> へ送るので、
// prefetch は切る。切らないと画面に入っただけで採番クエリが飛び、
// 先読みした古い番号へ飛んでしまう (App Router の prefetch={false} は
// hover でも発火しない)。
// /new は force-dynamic で loading.tsx を持たない = 押してから画面が
// 変わるまで何も起きないので、素の Link ではなく PendingLink で
// スピナーを出す (docs/11-アプリ的UIUX計画.md §1-2)。
// 中身が ＋ だけなのは幅を詰めるため。意味は aria-label / title で補う。
// 左右の余白を持たない正方形にするのも同じ理由 (COMPACT_ICON_BUTTON_CLASS)。
// **文字の "+" ではなく PlusIcon (svg)** にしてある (docs/62 §4) —
// 文字はフォント任せのベースラインに載るので、中央寄せしても
// 中央に見えなかった。緑なのは「足す」の合図 (icons/search.tsx)。
// スピナーは absolute で流れから抜く。流れに置くと ＋ と横に並んで
// 正方形からはみ出す (PendingLink の spinnerClassName)
//
// 検索結果の表示 (カレンダーなど) が自分の「足す」を持っていれば、＋は
// そちらへ向ける (docs/126 §1-17。カレンダーなら選んだ日の新しい予定)。
// 番号は押したときに振るのでリンクにしない
function NewItemButton({
  activeView,
  params,
}: {
  activeView: ResultView | null;
  params: ReadonlyURLSearchParams;
}) {
  const newItemHref = activeView?.newItemHref;
  return newItemHref !== undefined ? (
    <button
      type="button"
      aria-label={`${activeView?.label}に追加`}
      title={`${activeView?.label}に追加`}
      onClick={() => navigateTo(newItemHref(params.get("q") ?? "", params))}
      className={COMPACT_ICON_BUTTON_CLASS}
    >
      <PlusIcon />
    </button>
  ) : (
    <PendingLink
      href="/new"
      prefetch={false}
      aria-label="新規ノート"
      title="新規ノート"
      transitionTypes={["nav-forward"]}
      spinnerClassName="absolute right-0.5 top-0.5 text-emerald-600"
      className={`relative ${COMPACT_ICON_BUTTON_CLASS}`}
    >
      <PlusIcon />
    </PendingLink>
  );
}
