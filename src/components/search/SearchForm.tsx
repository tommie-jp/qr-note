"use client";

import type { ReactNode } from "react";
import { activeResultView } from "@/modules/registry";
import { SearchFormButtons, SearchInputBox } from "./SearchFormParts";
import { useSearchForm } from "./useSearchForm";

interface SearchFormProps {
  initialQuery: string;
  tags: string[];
  // デモかどうか。process.env はクライアントに渡らないのでサーバから降ろす
  // (SearchTools の stickerHost と同じ判断)。localStorage の引き取りだけが使う
  isDemo: boolean;
  // 窓の**左**に並べる別入口 (スキャン・画像検索。docs/86 §4-15)。
  // ここで受けるのは、行を 1 本の flex に保つため — 外で
  // `<div class=flex>{tools}<SearchForm/></div>` と包むと、窓の flex-1 が
  // 内側の form に閉じてしまい、伸び縮みの基準が 2 段に割れる。
  // 中身を知らずに受け取るので、SearchForm 側にカメラ系の import は増えない
  leading?: ReactNode;
}

// 検索窓。素の GET フォームのまま、候補ドロップダウンで入力を助ける
// (JS 無効でも検索自体は動く)。出す候補は 4 種類あって、混ざることはない
// (docs/59-検索候補計画.md §1):
//
//   窓が空          … 登録パターン (★) → 最近の検索 (🕐)
//   `#…` を打ちかけ … タグ候補
//   その他の語      … キーワード候補 (is:todo / is:done / is:untagged)
//
// 部品の分担: いつ引くか (useSearchDebounce)、候補の元 (useSavedQueries)、
// ドロップダウンの開閉と選択 (useSuggestDropdown、判断は lib/search/suggest.ts)、
// 描画 (SuggestionList)。ここは窓の値・キャレット・フォーカスを持って繋ぐ。
//
// スキャナと画像検索は所有しない。ボタンが下部バーへ抜けた時点で所有権も
// 渡し (docs/31 §5-1)、バーを畳んだいまは SearchTools が持っている
// (docs/86 §4-15)。この行に**置き場所として**戻ってきただけなので、
// 重いモーダルの dynamic import はここには来ない — leading で受け取る。
export function SearchForm({
  initialQuery,
  tags,
  isDemo,
  leading,
}: SearchFormProps) {
  const {
    params,
    query,
    formRef,
    inputRef,
    compositionHandlers,
    dropdown,
    handlers,
    suggestHandlers,
  } = useSearchForm(initialQuery, tags, isDemo);
  const activeView = activeResultView(params);

  return (
    // ボタンは 4 つ (スキャン・画像検索・検索・+)。すべて 36px 角なので
    // 320px でも 1 行に収まり、折り返しは要らない。入力窓の min-w だけは
    // 残す (これが無いと窓が潰れて横スクロールが出る)
    <form
      ref={formRef}
      method="GET"
      action="/"
      onSubmit={handlers.onSubmit}
      className="relative flex items-start gap-1.5"
    >
      {/* 窓の左に置く別入口 (docs/86 §4-15)。**form の中でよい** —
          中身は type="button" なので送信を起こさない。外に出すと
          窓の flex-1 の基準が 2 段に割れる (SearchFormProps の leading 参照) */}
      {leading}
      <SearchInputBox
        query={query}
        dropdown={dropdown}
        inputRef={inputRef}
        handlers={handlers}
        suggestHandlers={suggestHandlers}
        compositionHandlers={compositionHandlers}
      />
      <SearchFormButtons activeView={activeView} params={params} />
    </form>
  );
}
