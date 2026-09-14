"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { PlusIcon, SearchIcon } from "@/components/icons";
import { useKeyboardDismissOnScroll } from "@/components/hooks/useKeyboardDismissOnScroll";
import { PendingLink } from "@/components/PendingLink";
import { SearchClearButton } from "@/components/search/SearchClearButton";
import { SuggestionList } from "@/components/search/SuggestionList";
import { useSavedQueries } from "@/components/search/useSavedQueries";
import { useSearchDebounce } from "@/components/search/useSearchDebounce";
import { useSuggestDropdown } from "@/components/search/useSuggestDropdown";
import { useSearchNav } from "@/components/SearchNav";
import {
  COMPACT_ICON_BUTTON_CLASS,
  COMPACT_INPUT_CLASS,
  COMPACT_PRIMARY_ICON_BUTTON_CLASS,
} from "@/components/ui";
import { replaceRange, type Completion } from "@/lib/queryComplete";
import {
  insertTextOf,
  type Dropdown,
  type Suggestion,
} from "@/lib/search/suggest";
import { recordQueryUse } from "@/lib/searchQueryClient";

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
//   その他の語      … キーワード候補 (is:todo / is:done)
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
  const { navigate } = useSearchNav();
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
  const { dropdown } = suggest;

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

  // URL の検索語が外から変わったら窓も合わせる (スキャン・タグリンク・戻る)。
  // 入力中 (窓にフォーカスがある) は反映しない: 自分が投げた検索の結果が返る頃には
  // 続きを打っていることがあり、URL で上書きすると打った文字が消えるため。
  // フォーカスがなければ URL が正で、打ち終わった後は最後の応答に必ず追いつく
  const [syncedQuery, setSyncedQuery] = useState(initialQuery);
  if (initialQuery !== syncedQuery) {
    setSyncedQuery(initialQuery);
    if (!isFocused) {
      setQuery(initialQuery);
      suggest.close();
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    suggest.refresh(value, e.target.selectionStart ?? value.length);
    searchTyped(value);
  };

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

  // 候補の行を登録パターンに入れる / 外す (docs/59-検索候補計画.md §4)。
  const toggleSaved = (s: Suggestion, dd: Dropdown) => {
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

  // JS が動くならクライアント遷移で結果だけ差し替える (全体の再読込を避ける)。
  // JS 無効なら preventDefault が走らず、素の GET フォームとして今までどおり動く
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // 明示的な送信は「これで探したい」の合図なので記録する。
    // 打鍵ごとの検索 (searchTyped) では記録しない — 打ちかけの語が並ぶため
    recordQueryUse(query);
    searchNow(query);
    // モバイルでキーボードを閉じて結果を見せる
    inputRef.current?.blur();
  };

  return (
    // ボタンは 4 つ (スキャン・画像検索・検索・+)。すべて 36px 角なので
    // 320px でも 1 行に収まり、折り返しは要らない。入力窓の min-w だけは
    // 残す (これが無いと窓が潰れて横スクロールが出る)
    <form
      ref={formRef}
      method="GET"
      action="/"
      onSubmit={handleSubmit}
      className="relative flex items-start gap-1.5"
    >
      {/* 窓の左に置く別入口 (docs/86 §4-15)。**form の中でよい** —
          中身は type="button" なので送信を起こさない。外に出すと
          窓の flex-1 の基準が 2 段に割れる (SearchFormProps の leading 参照) */}
      {leading}
      {/* min-w-[10rem] ではなく px で持つ。テキストサイズ (docs/61) は root の
          font-size を動かすので、rem の下限は倍率ぶん広がり、200% では窓だけで
          320px を要求して画面ごと横スクロールになる。窓の中の文字は倍率どおり
          大きくなるので、器の下限まで一緒に広げる必要はない */}
      <div className="relative min-w-[160px] flex-1">
        <input
          ref={inputRef}
          type="search"
          name="q"
          value={query}
          onChange={handleChange}
          onKeyDown={(e) => suggest.handleKeyDown(e, { accept, extend })}
          {...compositionHandlers}
          onClick={(e) =>
            suggest.refresh(
              e.currentTarget.value,
              e.currentTarget.selectionStart ?? 0,
            )
          }
          // フォーカスしただけで候補を出す。窓が空なら登録パターンと
          // 最近の検索、打ちかけならその続き (docs/59-検索候補計画.md §1)
          onFocus={(e) => {
            setIsFocused(true);
            // 候補はここで初めて要る値なので、読むのもここ 1 回きりでよい
            // (描画のたびには引かない。docs/59-検索候補計画.md §7)
            reloadLists();
            suggest.refresh(
              e.currentTarget.value,
              e.currentTarget.selectionStart ?? 0,
            );
          }}
          onBlur={() => {
            setIsFocused(false);
            suggest.close();
          }}
          placeholder="部品番号・メモ・URL を全文検索（スペースで AND、|で OR、#でタグ）"
          autoComplete="off"
          role="combobox"
          aria-expanded={dropdown !== null}
          aria-autocomplete="list"
          aria-controls="search-suggestions"
          // pr-9 … 右端に重ねる ✕ のぶんを空ける。空けないと長い検索語の
          // 末尾が ✕ の下へ潜る。**空でも空けたままにする** — 出たり
          // 消えたりで文字が横に跳ねるほうが目に付く。
          // [&::-webkit-search-cancel-button]:hidden … 標準の ✕ を消す。
          // 消さないと Windows の Chrome/Edge だけ ✕ が 2 つ並ぶ
          className={`w-full pr-9 ${COMPACT_INPUT_CLASS} [&::-webkit-search-cancel-button]:hidden`}
        />
        {/* 空のときは ✕ を出さない — 消す物が無いのに押せる的があると、
            押してから何も起きないことに気づく */}
        {query !== "" && (
          <SearchClearButton
            onClear={() => {
              // **フォーカスを先に戻す。** 窓から外れていた場合 (結果を
              // スクロールするとキーボードを閉じるため blur する) は
              // focus() が onFocus を同期で走らせ、その中の refresh が
              // **まだ古い値が入っている DOM** を読んで候補を組み直す。
              // 後に回すと、こちらで出した一覧をそれが上書きしてしまう
              inputRef.current?.focus();
              setQuery("");
              suggest.showList();
              searchNow("");
            }}
          />
        )}
        {dropdown && (
          <SuggestionList
            dropdown={dropdown}
            anchorRef={inputRef}
            onAccept={accept}
            onToggleSaved={toggleSaved}
            onShowMore={() => {
              suggest.showList(true);
              inputRef.current?.focus();
            }}
          />
        )}
      </div>
      {/* ボタンは 1 つの塊にまとめる。塊にしないと狭い画面で
          「検索だけ入力窓と同じ行に残る」散らかった並びになる。
          スキャン・画像検索は下部バーへ移したので残りは 2 つ
          (docs/31-下部操作バー計画.md §2) */}
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
        {/* 空ノートを作る (docs/27-新規ノート追加計画.md)。
            遷移先の /new は押した瞬間に採番して /edit/<番号> へ送るので、
            prefetch は切る。切らないと画面に入っただけで採番クエリが飛び、
            先読みした古い番号へ飛んでしまう (App Router の prefetch={false} は
            hover でも発火しない)。
            /new は force-dynamic で loading.tsx を持たない = 押してから画面が
            変わるまで何も起きないので、素の Link ではなく PendingLink で
            スピナーを出す (docs/11-アプリ的UIUX計画.md §1-2)。
            中身が ＋ だけなのは幅を詰めるため。意味は aria-label / title で補う。
            左右の余白を持たない正方形にするのも同じ理由 (COMPACT_ICON_BUTTON_CLASS)。
            **文字の "+" ではなく PlusIcon (svg)** にしてある (docs/62 §4) —
            文字はフォント任せのベースラインに載るので、中央寄せしても
            中央に見えなかった。緑なのは「足す」の合図 (icons/search.tsx)。
            スピナーは absolute で流れから抜く。流れに置くと ＋ と横に並んで
            正方形からはみ出す (PendingLink の spinnerClassName) */}
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
      </div>
    </form>
  );
}
