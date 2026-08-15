"use client";

import { useEffect, useRef, useState } from "react";
import { ClearIcon, PlusIcon, SearchIcon } from "@/components/MenuIcons";
import { PendingLink } from "@/components/PendingLink";
import { useSearchNav } from "@/components/SearchNav";
import {
  COMPACT_ICON_BUTTON_CLASS,
  COMPACT_INPUT_CLASS,
  COMPACT_PRIMARY_ICON_BUTTON_CLASS,
} from "@/components/ui";
import {
  keywordContextAtCursor,
  matchKeywords,
} from "@/lib/keywordComplete";
import {
  replaceRange,
  type CompleteRange,
} from "@/lib/queryComplete";
import {
  cachedQueries,
  fetchQueries,
  recordQueryUse,
  registerSavedQuery,
  unregisterSavedQuery,
} from "@/lib/searchQueryClient";
import { migrateLegacyQueries } from "@/lib/searchQueryLegacy";
import {
  addSavedQuery,
  applyQueryUse,
  isSavedFull,
  removeSavedQuery,
  SAVED_LIMIT,
  splitSuggestions,
  type QueryLists,
} from "@/lib/searchQueries";
import {
  longestCommonPrefix,
  matchTags,
  tagContextAtCursor,
} from "@/lib/tagComplete";

interface SearchFormProps {
  initialQuery: string;
  tags: string[];
  // デモかどうか。process.env はクライアントに渡らないのでサーバから降ろす
  // (BottomActionBar の isProd と同じ判断)。localStorage の引き取りだけが使う
  isDemo: boolean;
}

// ドロップダウンに並ぶ 1 行 (docs/59-検索候補計画.md §1)。
//
//   tag / keyword … 打ちかけのトークンを置き換える (続きの補完)
//   saved / recent … クエリ全体を差し替える (打ちかけの語は捨てる)
type SuggestKind = "tag" | "keyword" | "saved" | "recent";

interface Suggestion {
  kind: SuggestKind;
  // tag はタグ名 (# を含まない)、他は挿入する文字列そのもの
  value: string;
}

// 一覧 (パターン + 最近の検索) を出しているときだけ持つ状態。
interface ListState {
  expanded: boolean; // 「もっと表示」を押した後か
  hasMore: boolean; // まだ出していない候補があるか
  // 登録が上限に達しているか。**出ている ★ の数では判断できない** —
  // 畳んでいる間は登録済みでも隠れている物があるため
  savedFull: boolean;
}

interface Dropdown {
  // 補完中のトークン。パターン・最近の検索を並べているときは null。
  // 候補は「補完だけ」か「一覧だけ」のどちらかで、混ざることはない
  token: { range: CompleteRange; typed: string } | null;
  list: ListState | null; // token と裏表 (どちらか一方だけが非 null)
  items: Suggestion[];
  active: number; // -1 = 未選択 (この間は Enter で検索送信)
}

const MAX_CANDIDATES = 8;

// 候補として実際に挿入する文字列。タグだけ `#` が要る
function insertTextOf(s: Suggestion): string {
  return s.kind === "tag" ? `#${s.value}` : s.value;
}

// 打ち終わりを待つ間隔。短すぎると 1 文字ごとに DB を引き、長いと反応が鈍い
const SEARCH_DEBOUNCE_MS = 300;

// 検索窓。素の GET フォームのまま、候補ドロップダウンで入力を助ける
// (JS 無効でも検索自体は動く)。出す候補は 4 種類あって、混ざることはない
// (docs/59-検索候補計画.md §1):
//
//   窓が空          … 登録パターン (★) → 最近の検索 (🕐)
//   `#…` を打ちかけ … タグ候補
//   その他の語      … キーワード候補 (is:todo / is:done)
//
// スキャナと画像検索のモーダルは以前ここが持っていたが、ボタンが下部バーへ
// 移ったので所有権も BottomActionBar へ渡した (docs/31-下部操作バー計画.md §5-1)。
export function SearchForm({ initialQuery, tags, isDemo }: SearchFormProps) {
  const { navigate } = useSearchNav();
  const [query, setQuery] = useState(initialQuery);
  const [dropdown, setDropdown] = useState<Dropdown | null>(null);
  // サーバから受け取った候補 (docs/59-検索候補計画.md §7)。null = まだ読めて
  // いない。初期値にモジュールのキャッシュを使うことで、一度読んだ後は
  // ページを移っても開いた瞬間に出る (取り直しは並行して走る)
  const [lists, setLists] = useState<QueryLists | null>(() => cachedQueries());
  // 入力中かどうか (URL の反映を止める判断に使う)
  const [isFocused, setIsFocused] = useState(false);
  // Escape で候補を閉じたか。閉じた後にサーバの取得が届いても開き直さない
  const [dismissed, setDismissed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // 補完適用後にキャレット位置を復元するための保留値。
  const pendingCaret = useRef<number | null>(null);
  // 打ち終わり待ちのタイマーと、IME で変換中かどうか。
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isComposing = useRef(false);

  useEffect(() => {
    if (pendingCaret.current !== null && inputRef.current) {
      const pos = pendingCaret.current;
      inputRef.current.setSelectionRange(pos, pos);
      pendingCaret.current = null;
    }
  });

  useEffect(() => {
    return () => {
      if (searchTimer.current) {
        clearTimeout(searchTimer.current);
      }
    };
  }, []);

  // 結果をスクロールし始めたらキーボードを閉じる
  // (docs/31-下部操作バー計画.md §8-3)。iOS 純正アプリ (メール・設定の検索) の
  // keyboardDismissMode = .onDrag と同じ作法。
  //
  // 動機は 2 つ。1 つは iOS がキーボード表示中のスクロールで position:fixed を
  // ビジュアルビューポートの下端へ貼り直すため、下部バーが一覧の途中にせり上がって
  // 浮くこと。もう 1 つは、結果を読みに行く段になってもキーボードが画面の半分を
  // 占め続けること。閉じれば両方が同時に片付く。
  //
  // **scroll ではなく touchmove で拾う。** キーボードが開くとき iOS は入力欄を
  // 見せるために自前でスクロールするので、scroll だと開いた直後に自分で閉じてしまう。
  // touchmove なら必ず指が動かした合図になる。
  //
  // 入力欄の中で始まった指の動き (文字列選択) では閉じない。フォームの中から
  // 始まったかどうかを touchstart で覚えておいて判別する。
  useEffect(() => {
    if (!isFocused) {
      return;
    }
    let startedInsideForm = false;
    const onTouchStart = (e: TouchEvent) => {
      const target = e.target;
      startedInsideForm =
        target instanceof Node && (formRef.current?.contains(target) ?? false);
    };
    const onTouchMove = () => {
      if (startedInsideForm) {
        return;
      }
      inputRef.current?.blur();
    };
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
    };
  }, [isFocused]);

  // URL の検索語が外から変わったら窓も合わせる (スキャン・タグリンク・戻る)。
  // 入力中 (窓にフォーカスがある) は反映しない: 自分が投げた検索の結果が返る頃には
  // 続きを打っていることがあり、URL で上書きすると打った文字が消えるため。
  // フォーカスがなければ URL が正で、打ち終わった後は最後の応答に必ず追いつく
  const [syncedQuery, setSyncedQuery] = useState(initialQuery);
  if (initialQuery !== syncedQuery) {
    setSyncedQuery(initialQuery);
    if (!isFocused) {
      setQuery(initialQuery);
      setDropdown(null);
    }
  }

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

  // 登録パターンと最近の検索を並べたドロップダウン (窓が空のとき)。
  //
  // source を渡せるようにしてあるのは、サーバから届いた直後の値で組みたい
  // ことがあるため (state はまだ古い)。省略時は今持っている物を使う。
  // まだ読めていない (null) なら出さない — 空の枠を出すより何も出さないほうがよい
  const openList = (
    source: QueryLists | null = lists,
    expanded = false,
  ): Dropdown | null => {
    if (source === null) {
      return null;
    }
    const shown = splitSuggestions(source.saved, source.recent, expanded);
    const items: Suggestion[] = [
      ...shown.saved.map((value): Suggestion => ({ kind: "saved", value })),
      ...shown.recent.map((value): Suggestion => ({ kind: "recent", value })),
    ];
    if (items.length === 0) {
      return null;
    }
    return {
      token: null,
      list: {
        expanded,
        hasMore: shown.hasMore,
        savedFull: isSavedFull(source.saved),
      },
      items,
      active: -1,
    };
  };

  // 候補をサーバから取り直す (docs/59-検索候補計画.md §7)。
  //
  // **開くたびに引き直す**。最近の検索は結果のノートを開いたときにも記録され
  // (SearchNav)、別の端末からも増えるので、一度読んで持っていると古い。
  // 待たせはしない — 届いたら下の同期ブロックが拾う
  const reloadLists = () => {
    void fetchQueries().then((next) => {
      if (next !== null) {
        setLists(next);
      }
    });
  };

  // 移す前の版が localStorage に残した登録パターンを引き取る (一度だけ)。
  // 引き取り終わったら searchQueryLegacy.ts ごと消す。
  // デモは受け取らないので送りもしない (searchQueryLegacy.ts 冒頭)
  useEffect(() => {
    void migrateLegacyQueries(isDemo).then((next) => {
      if (next !== null) {
        setLists(next);
      }
    });
  }, [isDemo]);

  // サーバから候補が届いたとき。
  //
  // **開いている一覧は組み直さない** — 並びが指の下で動くと、続けて押した指が
  // 隣の検索語を登録してしまう (toggleSaved と同じ理由)。閉じているときだけ
  // 開く = 「読めていなくて出せなかった」を後から拾う。開いている場合の新しい
  // 値は、次に開いたときに使われる
  //
  // Escape で閉じた後は開き直さない。**閉じたのに勝手に開く**のがいちばん
  // 困る形で、フォーカスしたときの取得はまだ飛んでいるので必ず後から届く
  const [syncedLists, setSyncedLists] = useState(lists);
  if (lists !== syncedLists) {
    setSyncedLists(lists);
    if (dropdown === null && isFocused && !dismissed && query.trim() === "") {
      setDropdown(openList(lists));
    }
  }

  // 現在の値とキャレット位置から出すべき候補を決める (docs/59 §1)。
  // タグ → キーワード → (空欄なら) 一覧 の順に見る。
  const refresh = (value: string, caret: number) => {
    // 打つ・押す・フォーカスし直すのはどれも「また出してよい」の合図。
    // Escape で閉じたことは、ここでご破算にする
    setDismissed(false);
    const tagCtx = tagContextAtCursor(value, caret);
    if (tagCtx) {
      const names = matchTags(tagCtx.prefix, tags, MAX_CANDIDATES);
      // 打ち終わったタグ 1 つだけが残る形 (`#抵抗` に対して候補も「抵抗」) では
      // 出さない。選んでも何も変わらないのに結果を覆うだけで、窓へフォーカス
      // するたびに出てくる。matchTags 側で落とさないのは、`#ab` に対する
      // 候補が [ab, abc] のとき Tab が `#abc` まで走ってしまうため
      const settled = names.length === 1 && names[0] === tagCtx.prefix;
      setDropdown(
        names.length > 0 && !settled
          ? {
              token: { range: tagCtx, typed: `#${tagCtx.prefix}` },
              list: null,
              items: names.map((value) => ({ kind: "tag", value })),
              active: -1,
            }
          : null,
      );
      return;
    }

    const kwCtx = keywordContextAtCursor(value, caret);
    if (kwCtx) {
      const keywords = matchKeywords(kwCtx.prefix);
      setDropdown(
        keywords.length > 0
          ? {
              token: { range: kwCtx, typed: kwCtx.prefix },
              list: null,
              items: keywords.map((value) => ({ kind: "keyword", value })),
              active: -1,
            }
          : null,
      );
      return;
    }

    setDropdown(value.trim() === "" ? openList() : null);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    refresh(value, e.target.selectionStart ?? value.length);
    // IME の変換中は検索しない。確定前の文字で引いても意味がなく、
    // 変換候補を選ぶたびにサーバへ行くことになる (compositionend で拾う)
    if (!isComposing.current) {
      scheduleSearch(value);
    }
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
      setDropdown(null);
      inputRef.current?.focus();
      recordQueryUse(next);
      searchNow(next);
      return;
    }
    // パターン・最近 … クエリ全体を差し替える。結果を見に行く操作なので
    // 送信と同じくキーボードを閉じる
    setQuery(s.value);
    setDropdown(null);
    inputRef.current?.blur();
    recordQueryUse(s.value);
    searchNow(s.value);
  };

  // 候補の行を登録パターンに入れる / 外す (docs/59-検索候補計画.md §4)。
  //
  // 押した後もドロップダウンは開いたままにするが、**行の並びは動かさない**。
  // 登録した行を ★ の欄へ移すと下の行が 1 つずつ繰り上がり、続けて押した指が
  // 隣の検索語を登録してしまう。★/☆ と 🕐 が切り替わるだけで合図は足りるので、
  // 並べ直すのは次に開いたときでよい
  const toggleSaved = (s: Suggestion, dd: Dropdown) => {
    if (lists === null) {
      return; // まだ読めていない。知らない物へ書き戻さない
    }
    if (s.kind === "recent" && isSavedFull(lists.saved)) {
      // 満杯。☆ は押せなくしてあるが、別の端末で埋まった場合は一覧を組んだ
      // 時点の値がまだ「空きあり」なので押せてしまう。**黙って何も起きない
      // のがいちばん困る** (登録したつもりになる) ので、押せない見た目へ
      // 直して理由を出す (☆ の title)
      setDropdown({ ...dd, list: dd.list && { ...dd.list, savedFull: true } });
      return;
    }
    // 外した行はその場で 🕐 に変わるので、履歴にも実際に入れておく。
    // 入れないと「閉じて開いたら消えていた」になる (登録パターンとして
    // 使っていた間は履歴へ足していないため)。サーバも同じことをする
    // (searchQueryStore の unregisterSaved) ので、手元と答えが揃う
    const next: QueryLists =
      s.kind === "saved"
        ? applyQueryUse(
            { saved: removeSavedQuery(lists.saved, s.value), recent: lists.recent },
            s.value,
          )
        : { saved: addSavedQuery(lists.saved, s.value), recent: lists.recent };
    // 楽観更新。★ を押した手応えを往復待ちにしない
    setLists(next);
    void (
      s.kind === "saved"
        ? unregisterSavedQuery(s.value)
        : registerSavedQuery(s.value)
    ).then((server) => {
      // 断られた (満杯・通信断) ときは null。手元の楽観更新は次に開いたときの
      // 読み直しで正本に戻るので、ここで巻き戻して画面を跳ねさせない
      if (server !== null) {
        setLists(server);
      }
    });
    setDropdown({
      ...dd,
      list: dd.list && { ...dd.list, savedFull: isSavedFull(next.saved) },
      items: dd.items.map((it) => ({
        kind: next.saved.includes(it.value) ? "saved" : "recent",
        value: it.value,
      })),
    });
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // IME 変換中 (日本語入力) のキーは補完に横取りしない。
    if (e.nativeEvent.isComposing) return;
    if (!dropdown) return;
    const { token, items, active } = dropdown;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setDropdown({ ...dropdown, active: (active + 1) % items.length });
        break;
      case "ArrowUp":
        e.preventDefault();
        setDropdown({
          ...dropdown,
          active: active <= 0 ? items.length - 1 : active - 1,
        });
        break;
      case "Enter":
        // 候補を選択中のときだけ確定。未選択なら送信を妨げない。
        if (active >= 0) {
          e.preventDefault();
          accept(items[active], dropdown);
        }
        break;
      case "Tab": {
        // bash 流: 一意なら確定、複数なら最長共通プレフィックスまで伸ばす。
        // 打ちかけのトークンがある補完のときだけ (一覧では伸ばす先がない)
        if (!token) break;
        e.preventDefault();
        if (items.length === 1) {
          accept(items[0], dropdown);
          break;
        }
        const lcp = longestCommonPrefix(items.map(insertTextOf));
        if (lcp.length > token.typed.length) {
          const { query: next, cursor } = replaceRange(query, token.range, lcp);
          setQuery(next);
          pendingCaret.current = cursor;
          refresh(next, cursor);
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

  // JS が動くならクライアント遷移で結果だけ差し替える (全体の再読込を避ける)。
  // JS 無効なら preventDefault が走らず、素の GET フォームとして今までどおり動く
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // 明示的な送信は「これで探したい」の合図なので記録する。
    // 打鍵ごとの検索 (scheduleSearch) では記録しない — 打ちかけの語が並ぶため
    recordQueryUse(query);
    searchNow(query);
    // モバイルでキーボードを閉じて結果を見せる
    inputRef.current?.blur();
  };

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
  const placeList = (el: HTMLUListElement | null) => {
    const box = inputRef.current?.getBoundingClientRect();
    if (!el || !box) return;
    // mt-1 相当の 4px を空ける。左右と幅は窓に揃える
    el.style.left = `${box.left}px`;
    el.style.top = `${box.bottom + 4}px`;
    el.style.width = `${box.width}px`;
  };

  // 開いている間は窓を追う。スクロール (capture で祖先の内側スクロールも
  // 拾う) と大きさの変化で窓が動くため
  const isOpen = dropdown !== null;
  useEffect(() => {
    if (!isOpen) return;
    const update = () => placeList(listRef.current);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [isOpen]);

  const savedFull = dropdown?.list?.savedFull ?? false;

  return (
    // スキャン・画像検索が下部バーへ抜けてボタンは 2 つ (検索・+) になったので、
    // 320px でも 1 行に収まり折り返しは要らなくなった。入力窓の min-w だけは
    // 残す (これが無いと窓が潰れて横スクロールが出る)
    <form
      ref={formRef}
      method="GET"
      action="/"
      onSubmit={handleSubmit}
      className="relative flex items-start gap-1.5"
    >
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
          onKeyDown={handleKeyDown}
          onCompositionStart={() => {
            isComposing.current = true;
          }}
          onCompositionEnd={(e) => {
            isComposing.current = false;
            scheduleSearch(e.currentTarget.value);
          }}
          onClick={(e) =>
            refresh(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)
          }
          // フォーカスしただけで候補を出す。窓が空なら登録パターンと
          // 最近の検索、打ちかけならその続き (docs/59-検索候補計画.md §1)
          onFocus={(e) => {
            setIsFocused(true);
            // 候補はここで初めて要る値なので、読むのもここ 1 回きりでよい
            // (描画のたびには引かない。docs/59-検索候補計画.md §7)
            reloadLists();
            refresh(e.currentTarget.value, e.currentTarget.selectionStart ?? 0);
          }}
          onBlur={() => {
            setIsFocused(false);
            setDropdown(null);
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
        {/* 検索語を消す ✕ (docs/62 §6)。標準のものは iOS Safari と
            Android Chrome に無いので自前で持つ。
            空のときは出さない — 消す物が無いのに押せる的があると、
            押してから何も起きないことに気づく。
            mousedown で preventDefault … これが無いと押した瞬間に入力欄が
            blur し、onBlur がドロップダウンを閉じてしまう (★/☆ と同じ手) */}
        {query !== "" && (
          <button
            type="button"
            tabIndex={-1}
            aria-label="検索語を消す"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              // **フォーカスを先に戻す。** 窓から外れていた場合 (結果を
              // スクロールするとキーボードを閉じるため blur する) は
              // focus() が onFocus を同期で走らせ、その中の refresh が
              // **まだ古い値が入っている DOM** を読んで候補を組み直す。
              // 後に回すと、こちらで出した一覧をそれが上書きしてしまう
              inputRef.current?.focus();
              setQuery("");
              setDropdown(openList());
              searchNow("");
            }}
            className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 active:bg-gray-200"
          >
            <ClearIcon />
          </button>
        )}
        {dropdown && (
          <ul
            id="search-suggestions"
            role="listbox"
            // **fixed で器の外へ出す** (docs/86 §4-13)。3 ペインでは器が
            // overflow:hidden なので、absolute のままだと候補の下半分が
            // 切られる。位置は上の effect が窓から実測して入れる。
            // z-30 … ノートのペイン (z-0) と下部バー (z-10) より上。
            // max-h + overflow-y-auto … 候補が多いときに画面の外へ
            // 突き抜けないための保険 (SlotMenu と同じ作法)
            ref={(el) => {
              listRef.current = el;
              placeList(el);
            }}
            className="fixed z-30 max-h-[60vh] overflow-y-auto overscroll-contain rounded border border-gray-300 bg-white shadow-lg"
          >
            {dropdown.items.map((s, i) => (
              // key は値だけ。★/☆ を押すと kind が入れ替わるので、kind を
              // 混ぜると押した行が作り直されてしまう
              <li
                key={s.value}
                role="option"
                aria-selected={i === dropdown.active}
                // blur より先に確定するため mousedown で拾う。
                onMouseDown={(e) => {
                  e.preventDefault();
                  accept(s, dropdown);
                }}
                // 登録パターンと最近の検索の境目に線を引く。同じ見た目で
                // 続けると、固定の 3 件と入れ替わる 3 件が地続きに見える
                // 行の高さは本文の 1 行ぶん (py-0.5 + text-sm の行送り ≒ 24px。
                // docs/86 §4-13)。40px のタップ目標は取らない — 候補は
                // 1 画面にいくつ並ぶかがそのまま使い勝手になる場所で、
                // フォルダーペインの行と同じ判断
                className={`flex cursor-pointer items-center gap-2 px-3 py-0.5 text-sm ${
                  s.kind === "recent" &&
                  dropdown.items[i - 1]?.kind === "saved"
                    ? "border-t border-gray-200"
                    : ""
                } ${
                  i === dropdown.active
                    ? "bg-blue-600 text-white"
                    : "text-gray-700 hover:bg-gray-100"
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
                      toggleSaved(s, dropdown);
                    }}
                    className="-mr-1 flex size-6 shrink-0 items-center justify-center rounded text-amber-500 hover:bg-black/10 disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    {s.kind === "saved" ? "★" : "☆"}
                  </button>
                )}
              </li>
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
                    setDropdown(openList(lists, true));
                    inputRef.current?.focus();
                  }}
                  className="flex w-full items-center justify-center px-3 py-1 text-sm text-blue-600 hover:bg-gray-100"
                >
                  もっと表示
                </button>
              </li>
            )}
          </ul>
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
            中央に見えなかった。緑なのは「足す」の合図 (MenuIcons.tsx)。
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
