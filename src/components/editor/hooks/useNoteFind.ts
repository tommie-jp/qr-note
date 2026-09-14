"use client";

import { undo } from "@codemirror/commands";
import {
  findNext,
  findPrevious,
  setSearchQuery,
  type SearchQuery,
} from "@codemirror/search";
import type { Text } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { useCallback, useEffect, useRef, useState } from "react";
import type { NoteSearchBarProps } from "@/components/editor/NoteSearchBar";
import {
  buildQuery,
  canUndoReplace,
  countMatches,
  firstMatchFrom,
  planReplaceAll,
  planReplaceCurrent,
  replaceOneNote,
  replaceAllNote,
  staleReplaceUndoNote,
  type NoteSearchNote,
} from "@/components/editor/noteSearch";
import type { NoteSearchController } from "@/components/editor/noteSearchHighlight";
import {
  EMPTY_FIND,
  findScrollMargin,
  findSeed,
  type FindState,
} from "@/lib/editor/findState";
import type { EditorRef } from "./types";

export interface NoteFind {
  // 開いている間、下部バーは編集ツールバーの代わりに検索バーを出す
  // (帯を 2 段にしない)
  findOpen: boolean;
  // 引数は置換行も開くか (ツールバーの長押し)
  openFind: (withReplace: boolean) => void;
  // 検索バー (NoteSearchBar) にそのまま渡す値と操作
  barProps: NoteSearchBarProps;
  // CodeMirror の onUpdate から呼ぶ (参照は変わらない)
  trackFindUpdate: (update: ViewUpdate) => void;
}

// ノート内検索・置換 (docs/76-ノート内検索計画.md)。
//
// 探す計算は noteSearch.ts、帯の見た目は NoteSearchBar.tsx、CodeMirror 側の
// ハイライトと鍵は noteSearchHighlight.ts。ここはその 3 つを繋ぐだけ。
export function useNoteFind({
  editorRef,
  noteSearch,
  hostEl,
  setLivePreviewSuspended,
}: {
  editorRef: EditorRef;
  noteSearch: NoteSearchController;
  // 下部バーの差し込み口。一致へ飛ぶときの余白を帯の高さから測る
  hostEl: HTMLElement | null;
  // ライブプレビューを検索中だけ畳む (§4)
  setLivePreviewSuspended: (suspended: boolean) => void;
}): NoteFind {
  const [findOpen, setFindOpen] = useState(false);
  const [find, setFind] = useState<FindState>(EMPTY_FIND);
  const [findCount, setFindCount] = useState({ total: 0, current: 0 });
  // 置換の結果・断り。次の検索操作か、帯を閉じるまで出したままにする
  // (タイマーで消さない — 「元に戻す」を押す間に消えては困る)
  const [findNote, setFindNote] = useState<NoteSearchNote | null>(null);
  // いまの検索条件。**参照を固定した onUpdate から読む**ので state ではなく ref
  // (state にすると onUpdate の参照が変わり、拡張一式が組み直される)
  const queryRef = useRef<SearchQuery | null>(null);
  // 打ちながら飛ぶときの起点 (帯を開いた時のカーソル位置)。いまの選択を起点に
  // すると、1 文字打ち足すたびに前へ前へと飛んで元の場所へ戻れなくなる
  const findAnchorRef = useRef(0);
  // 「元に戻す」を提げている全置換の控え (docs/76 §5-2)。置換した直後の本文で、
  // 本文が動いたら捨てる (canUndoReplace の理由)。**state ではなく ref** —
  // 参照を固定した onUpdate (trackFindUpdate) から読み書きするため
  const replacedDocRef = useRef<Text | null>(null);

  // 検索条件を CodeMirror へ渡し、件数を数え直す。
  // jump … 起点 (帯を開いた位置) から最初の一致へ飛ぶか
  const applyFind = (next: FindState, jump: boolean) => {
    setFind(next);
    setFindNote(null);
    const view = editorRef.current?.view;
    if (!view) {
      return;
    }
    const query = buildQuery(next.search, next.replace, next.caseSensitive);
    queryRef.current = query;
    // ハイライト (noteSearchHighlight) と findNext/findPrevious が
    // これを読む。パネルは開かないので、状態だけを差し替える
    view.dispatch({ effects: setSearchQuery.of(query) });
    const match = jump
      ? firstMatchFrom(view.state, query, findAnchorRef.current)
      : null;
    if (match) {
      view.dispatch({
        selection: { anchor: match.from, head: match.to },
        scrollIntoView: true,
      });
    }
    // 飛ばなかったとき (一致 0 件) は本文もカーソルも動かず onUpdate が
    // 呼ばれないので、ここで数える
    setFindCount(countMatches(view.state, query));
  };

  const openFind = (withReplace: boolean) => {
    const view = editorRef.current?.view;
    // 選んでからボタンを押したなら、その語を初期値にする (findSeed)
    const selected = view
      ? view.state.sliceDoc(
          view.state.selection.main.from,
          view.state.selection.main.to,
        )
      : "";
    const seed = findSeed(selected, find.search);
    findAnchorRef.current = view ? view.state.selection.main.from : 0;
    if (!findOpen) {
      setFindOpen(true);
      setLivePreviewSuspended(true);
    }
    applyFind(
      { ...find, search: seed, showReplace: withReplace || find.showReplace },
      seed !== "",
    );
  };

  // 閉じる。閉じるものが無ければ false (Escape を他へ譲る)
  const closeFind = (): boolean => {
    if (!findOpen) {
      return false;
    }
    setFindOpen(false);
    setFindNote(null);
    queryRef.current = null;
    const view = editorRef.current?.view;
    if (view) {
      // 空のクエリ = valid でない = ハイライトが消える
      view.dispatch({ effects: setSearchQuery.of(buildQuery("", "", false)) });
      setLivePreviewSuspended(false);
      view.focus();
    }
    return true;
  };

  // 次/前の一致へ。**帯が閉じていれば開く** (F3 / Ctrl+G から来る経路)。
  // 一致が無ければ何もしない — findNext は検索語が無いと標準パネルを
  // 開こうとするので、valid なときだけ通す
  const runFind = (command: (view: EditorView) => boolean): boolean => {
    if (!findOpen) {
      openFind(false);
      return true;
    }
    const view = editorRef.current?.view;
    const query = queryRef.current;
    if (!view || !query?.valid) {
      return true;
    }
    command(view);
    return true;
  };

  // 置換 (1 件): いまの一致を置き換えて次へ。一致の上にいなければ進むだけ
  const replaceOne = () => {
    const view = editorRef.current?.view;
    const query = queryRef.current;
    if (!view || !query?.valid) {
      return;
    }
    const plan = planReplaceCurrent(view.state, query);
    // 置き換えられなかった理由 (上限超え・シークレット記法) があれば知らせる
    setFindNote(replaceOneNote(plan));
    if (plan.tooLong) {
      // 上限超えは進まない — 何字消せばよいかを読んでもらう場面で、
      // 選択が次へ動くと知らせがどの一致の話か判らなくなる
      return;
    }
    if (plan.change) {
      view.dispatch({ changes: plan.change, userEvent: "input.replace" });
    }
    // シークレットで飛ばしたときも進む。次を押せば守った一致を通り越せる
    findNext(view);
  };

  // すべて置換 (§5)。1 トランザクションにまとめるので、戻すのは undo 1 回
  const replaceAll = () => {
    const view = editorRef.current?.view;
    const query = queryRef.current;
    if (!view || !query?.valid) {
      return;
    }
    const plan = planReplaceAll(view.state, query);
    const note = replaceAllNote(plan);
    if (plan.count > 0 && !plan.tooLong) {
      view.dispatch({ changes: plan.changes, userEvent: "input.replace.all" });
    }
    // 控えるのは dispatch の**後**。dispatch の中で trackFindUpdate が走るので、
    // 先に控えると自分の置換を「本文が動いた」と見て捨ててしまう
    replacedDocRef.current = note.undo ? view.state.doc : null;
    setFindNote(note);
  };

  // 知らせの「元に戻す」。押した後は知らせを畳む (戻した物をもう一度
  // 戻せるように見えてはいけない)。
  // **フォーカスは戻さない** — 帯で作業している最中なので、エディタへ
  // 移すとスマホではキーボードが入れ替わって続きが打てなくなる
  const undoReplace = () => {
    const view = editorRef.current?.view;
    const replacedDoc = replacedDocRef.current;
    replacedDocRef.current = null;
    if (!view) {
      setFindNote(null);
      return;
    }
    // 本文が動いた後に押された (「元に戻す」を下げるより速く押された取り合い)。
    // ここで undo すると、置換ではなく直前の手が戻る (docs/76 §5-2)
    if (!canUndoReplace(replacedDoc, view.state.doc)) {
      setFindNote(staleReplaceUndoNote());
      return;
    }
    setFindNote(null);
    undo(view);
  };

  // 帯とソフトキーボードのぶんだけ、一致の下に余白を空ける (§6)。
  // **スクロールのたびに呼ばれる**ので、その時々の高さで計算できる
  const findBottomMargin = (): number => {
    if (!findOpen) {
      return 0;
    }
    return findScrollMargin(
      hostEl?.getBoundingClientRect().height ?? 0,
      window.innerHeight,
      window.visualViewport?.height ?? null,
    );
  };

  // 鍵 (Ctrl+F / F3 / Escape) とスクロール余白から呼ばれる口を、毎描画で
  // 今の関数に差し替える。**依存配列は付けない** — 上の関数は毎描画で作り
  // 直され、掴んでいる state (findOpen・find) もそのつど変わるため。
  //
  // 拡張は一度しか組まない (useEditorExtensions) ので、ここを通さないと
  // 「マウント時の関数」を永久に掴んだままになる (押しても閉じた状態のまま動く)
  useEffect(() => {
    noteSearch.update({
      onOpen: openFind,
      onFindNext: () => runFind(findNext),
      onFindPrev: () => runFind(findPrevious),
      onEscape: closeFind,
      bottomMargin: findBottomMargin,
    });
  });

  const trackFindUpdate = useCallback((update: ViewUpdate) => {
    // 本文が動いたら全置換の「元に戻す」を下げる (docs/76 §5-2)。undo が戻すのは
    // いちばん新しい手なので、動いた後にも押させると置換ではなく打鍵が戻る。
    // **知らせの文 (「3 件置換しました」) は残す** — 消すと、押して戻ったのだと
    // 誤解される形に近づく。何件置換したかは読めたままにしておく
    if (update.docChanged && replacedDocRef.current) {
      replacedDocRef.current = null;
      setFindNote((prev) => (prev?.undo ? { ...prev, undo: false } : prev));
    }

    // 検索の件数と「何番目か」(docs/76 §2)。本文を直しても、次の一致へ
    // 送っても、置換しても必ずここを通る — 数え直す場所を 1 つにしておく。
    // 本文かカーソルが動いたときだけ数える。検索条件は ref から読む
    // (state にすると、この関数の参照が変わって拡張一式が組み直される)
    if (update.docChanged || update.selectionSet) {
      const query = queryRef.current;
      if (query?.valid) {
        const next = countMatches(update.state, query);
        setFindCount((prev) =>
          prev.total === next.total && prev.current === next.current
            ? prev
            : next,
        );
      }
    }
  }, []);

  const barProps: NoteSearchBarProps = {
    search: find.search,
    replace: find.replace,
    caseSensitive: find.caseSensitive,
    showReplace: find.showReplace,
    count: findCount,
    note: findNote,
    onSearchChange: (search) => applyFind({ ...find, search }, true),
    // 置換後の文字を変えても本文は動かない (飛ばない)
    onReplaceChange: (replace) => applyFind({ ...find, replace }, false),
    onToggleCase: () =>
      applyFind({ ...find, caseSensitive: !find.caseSensitive }, true),
    onToggleReplace: () => setFind({ ...find, showReplace: !find.showReplace }),
    onFindNext: () => runFind(findNext),
    onFindPrev: () => runFind(findPrevious),
    onReplaceOne: replaceOne,
    onReplaceAll: replaceAll,
    onUndo: undoReplace,
    onClose: closeFind,
  };

  return { findOpen, openFind, barProps, trackFindUpdate };
}
