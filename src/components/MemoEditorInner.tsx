"use client";

import { redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  findNext,
  findPrevious,
  setSearchQuery,
  type SearchQuery,
} from "@codemirror/search";
import { EditorState, type Text } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import "@atomic-editor/editor/styles.css";
// ライブプレビューの数式 (mathBlocks.ts) が KaTeX の組んだ HTML を出すので、
// 編集画面でもその CSS が要る。閲覧側 (MarkdownView) とは別の入り口なので
// ここでも読み込む — 無いと数式が素の文字列として崩れて出る
import "katex/dist/katex.min.css";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import dynamic from "next/dynamic";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useBottomBarSlot } from "@/components/BottomBarContext";
import { EditToolbar } from "@/components/EditToolbar";
import { PanelActiveContext } from "@/components/PanelActiveContext";
import { ACCEPTED_FILE_TYPES } from "@/lib/editor/attachmentKinds";
import { busyReason, isEditorBusy } from "@/lib/editor/busyReason";
import { insertText } from "@/lib/editor/cmDoc";
import { errorText } from "@/lib/errorMessage";
// 打ち止めと文字数表示は**サーバと同じ上限**を見る (別に持つと、編集画面が
// 止めているのにインポートは通る/その逆のずれ方をする)
import { MAX_TEXT_LENGTH } from "@/lib/validation";
import {
  ocrButtonLabel,
  recordButtonLabel,
  uploadButtonLabel,
} from "@/lib/progressLabels";
import {
  findSecretNotation,
  secretAtCursor,
  secretNotation,
  secretToolbarLabel,
} from "@/lib/secrets";
import { fenceLanguageCompletion } from "./fenceCompletion";
import { fenceLanguageLinter } from "./fenceLinter";
import {
  createLivePreviewCompartment,
  livePreviewContent,
} from "./editor/livePreview";
import { formatSpec, type FormatAction } from "./editor/markdownFormat";
import { NoteSearchBar } from "./editor/NoteSearchBar";
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
} from "./editor/noteSearch";
import { createNoteSearch } from "./editor/noteSearchHighlight";
import { quizLinter } from "./editor/quizLinter";
import { useAttachmentInsert } from "./editor/hooks/useAttachmentInsert";
import { useEditorClipboard } from "./editor/hooks/useEditorClipboard";
import { useEditorDrawing } from "./editor/hooks/useEditorDrawing";
import { useEditorOcr } from "./editor/hooks/useEditorOcr";
import { useEditorRecordings } from "./editor/hooks/useEditorRecordings";
import { useEditorScanInsert } from "./editor/hooks/useEditorScanInsert";
import { loadLivePreviewPref, saveLivePreviewPref } from "@/lib/livePreviewPref";
import { browserStorage } from "@/lib/prefs/storagePref";
import { BusyNotice } from "./BusyNotice";
import { VideoRecordModal } from "./VideoRecordModal";

// fabric 一式は重いので、お絵かきを開くまで読み込まない
// (CodeMirror を遅延させているのと同じ流儀。MemoEditor.tsx 参照)
const DrawModal = dynamic(() => import("./draw/DrawModal"), {
  ssr: false,
  loading: () => null,
});

// スキャナ (カメラ + zxing wasm) も重いので、スキャンを押すまで読み込まない。
// 検索画面 (BottomActionBar) と同じ部品を、挿入モード (onResult) で使う
const ScannerModal = dynamic(
  () => import("./ScannerModal").then((m) => m.ScannerModal),
  { ssr: false, loading: () => null },
);

// シークレットの入力ダイアログ (docs/51-部分暗号化計画.md §8)。
// 開くまで読み込まない (暗号まわり一式を普段の編集に載せない)
const SecretDialog = dynamic(
  () => import("./secret/SecretDialog").then((m) => m.SecretDialog),
  { ssr: false, loading: () => null },
);

export interface MemoEditorInnerProps {
  value: string;
  onChange: (value: string) => void;
  onReady: () => void;
  autoFocus?: boolean;
  minHeight?: string;
}

// CodeMirror に渡す設定はレンダリングごとに作り直さない。
// @uiw/react-codemirror は basicSetup / onUpdate の**参照**が変わるたびに
// StateEffect.reconfigure で拡張一式を組み直すため、毎回新しいオブジェクトを
// 渡すと打鍵のたびに全部が再構成される。録音中は 1 秒ごとに再レンダリングが
// 走るので、そのままだと再構成もその回数だけ起きる
const BASIC_SETUP = {
  lineNumbers: false,
  foldGutter: false,
  highlightActiveLine: false,
  // 標準の検索キーマップは外す (docs/76-ノート内検索計画.md §3)。
  // Ctrl+F は自前の帯へ差し替えるが、F3 / Ctrl+G が残っていると、検索語が
  // 無いときに CodeMirror 標準のパネルが開いてしまう (帯と二重に出る)。
  // 同じ鍵は noteSearchExtension が全部引き受ける
  searchKeymap: false,
} as const;

// ノート内検索の帯が持つ値 (docs/76-ノート内検索計画.md §2)。
// 閉じても捨てずに残す — 同じ語を続けて探すことが多い
interface FindState {
  search: string;
  replace: string;
  caseSensitive: boolean;
  showReplace: boolean;
}

const EMPTY_FIND: FindState = {
  search: "",
  replace: "",
  caseSensitive: false,
  showReplace: false,
};

// 一致へ飛ぶときに、下部バーとソフトキーボードの上に空けておく余白 (px)。
// 帯の高さは実測 (置換行の有無で変わる) し、これは「その少し上」ぶん
const FIND_SCROLL_GAP = 16;

// 検索語に引き継ぐ選択範囲の上限。長い範囲や複数行を入れても帯には収まらず、
// 消してから打ち直す手間が増えるだけ
const FIND_SEED_MAX = 50;

// markdown 用 CodeMirror エディタ本体 (制御コンポーネント)。
// 画像はペースト / ドラッグ&ドロップ / 画像ボタンで /api/images へアップロードし、
// カーソル位置に ![](url) を挿入する
export default function MemoEditorInner({
  value,
  onChange,
  onReady,
  autoFocus = false,
  minHeight = "14rem",
}: MemoEditorInnerProps) {
  const [error, setError] = useState<string | null>(null);
  // undo / redo ボタンの活殺 (docs/11-アプリ的UIUX計画.md §2-4)。
  // 履歴自体は basicSetup が既定で持っている (Ctrl+Z も従来どおり効く)
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  // シークレットの入力ダイアログ (docs/51-部分暗号化計画.md §8)。null なら閉じている。
  // name が非 null なら既存の断片の編集、null なら新規 (text は選択範囲)
  const [secret, setSecret] = useState<{
    name: string | null;
    text: string;
    label: string;
  } | null>(null);
  // ツールバーに出す文字。カーソルが記法の上なら「秘密を編集」に変わる
  // (docs/52 §1)。押した先の分岐は openSecret が持つので、これは見た目だけ
  const [secretLabel, setSecretLabel] = useState("秘密");
  // ライブプレビュー (docs/70-編集ライブプレビュー計画.md)。記法を隠して
  // 装飾済みに見せる表示で、**本文は書き換えない**。OFF は従来の編集表示。
  // この部品は ssr: false で読み込まれる (MemoEditor.tsx) ので、初期値を
  // localStorage から同期に読んでも hydration はずれない
  // (触れない環境では既定で動く。例外の扱いは prefs/storagePref.ts)
  const [livePreview, setLivePreview] = useState(() =>
    loadLivePreviewPref(browserStorage()),
  );
  // ノート内検索・置換 (docs/76-ノート内検索計画.md)。開いている間、下部バーは
  // 編集ツールバーの代わりに検索バーを出す (帯を 2 段にしない)
  const [findOpen, setFindOpen] = useState(false);
  const [find, setFind] = useState<FindState>(EMPTY_FIND);
  const [findCount, setFindCount] = useState({ total: 0, current: 0 });
  // 置換の結果・断り。次の検索操作か、帯を閉じるまで出したままにする
  // (タイマーで消さない — 「元に戻す」を押す間に消えては困る)
  const [findNote, setFindNote] = useState<NoteSearchNote | null>(null);
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // いまの検索条件。**参照を固定した onUpdate から読む**ので state ではなく ref
  // (state にすると onUpdate の参照が変わり、拡張一式が組み直される)
  const queryRef = useRef<SearchQuery | null>(null);
  // 打ちながら飛ぶときの起点 (帯を開いた時のカーソル位置)。いまの選択を起点に
  // すると、1 文字打ち足すたびに前へ前へと飛んで元の場所へ戻れなくなる
  const findAnchorRef = useRef(0);
  // 「元に戻す」を提げている全置換の控え (docs/76 §5-2)。置換した直後の本文で、
  // 本文が動いたら捨てる (canUndoReplace の理由)。**state ではなく ref** —
  // 参照を固定した onUpdate (handleUpdate) から読み書きするため
  const replacedDocRef = useRef<Text | null>(null);

  // タブパネル (MemoPanel) が hidden で保持する構成では、非表示タブでも
  // このコンポーネントはマウントされたまま。portal は hidden の枠を抜けて
  // 下部バーに残るので、表向きのタブのときだけ portal する (既定 true =
  // MemoPanel を通らない /edit ページでは常に表示扱い)
  const panelActive = useContext(PanelActiveContext);
  // 編集ボタンは下部バー (PageBottomBar) の差し込み口へ portal する。
  // portal は React ツリーの親子を保つので、囲みの <form> の子孫のまま —
  // useFormStatus (更新ボタン) が効き、onClick から下の state/ref も触れる。
  //
  // 帯は差し込む側がいるときだけ出るので、まず要ると申告する
  // (useBottomBarSlot)。口 (hostEl) が返るのは帯が描かれた次の描画から
  const hostEl = useBottomBarSlot(panelActive);

  useEffect(() => {
    onReady();
    // マウント時に一度だけ通知する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ocr = useEditorOcr({ editorRef, setError });
  // 戻り値は分けて受ける。fileInputRef (ref) と同じ入れ物のまま描画中に
  // 他の値を読むと、react-hooks/refs が「ref を描画中に読んだ」と見なす
  const {
    upload,
    uploading,
    insertFiles,
    fileEvents,
    fileInputRef,
    openFilePicker,
    handleFilePick,
  } = useAttachmentInsert({ editorRef, setError, ocrIntoDoc: ocr.ocrIntoDoc });
  const { recording, videoRecording, isRecording } = useEditorRecordings({
    editorRef,
    setError,
    insertFiles,
  });
  const { clipboardBusy, importClipboard } = useEditorClipboard({
    editorRef,
    setError,
    insertFiles,
  });
  const scan = useEditorScanInsert({ editorRef, setError });
  const drawings = useEditorDrawing({ editorRef, setError, insertFiles });

  // アップロード / OCR / 録音・録画の完了前に送信すると、画像リンクや OCR 結果、
  // 録音・録画そのものが memo に入らないため、処理中だけフォーム送信をブロックして知らせる
  const busy = isEditorBusy({
    isRecording,
    uploading,
    scanBusy: scan.scanBusy,
    clipboardBusy,
    ocrRunning: ocr.ocrCount > 0,
  });
  useEffect(() => {
    if (!busy) {
      return;
    }
    const form = wrapperRef.current?.closest("form");
    if (!form) {
      return;
    }
    const blockSubmit = (event: SubmitEvent) => {
      event.preventDefault();
      setError(
        busyReason({
          isRecording,
          uploading,
          scanBusy: scan.scanBusy,
          clipboardBusy,
        }),
      );
    };
    form.addEventListener("submit", blockSubmit);
    return () => form.removeEventListener("submit", blockSubmit);
  }, [busy, uploading, isRecording, scan.scanBusy, clipboardBusy]);

  // 拡張一式と、ライブプレビューの差し替え口を**一緒に**組む。
  // Compartment をここで作るのは、拡張と寿命を揃えるため — 外で作って
  // 配列の中から参照すると、拡張を組む useMemo の依存に載ってしまう
  // (載せれば切り替えのたびに全再構成、載せなければ lint が鳴る)
  const { extensions, livePreviewCompartment, noteSearch } = useMemo(() => {
    const livePreviewCompartment = createLivePreviewCompartment();
    // 検索の拡張と、その呼び出し先の差し替え口。Compartment と同じ理由で
    // ここで作る — 拡張と寿命を揃え、中身だけを後から差し替える
    const noteSearch = createNoteSearch();
    // markdown() は内部で新しい言語インスタンスを作ってそこに組み込み補完を
    // 登録する。export される markdownLanguage は別インスタンスのため、
    // そちらに登録しても効かない (バンドル環境で languageDataAt に載らない)。
    // markdown() が返した当のインスタンス (md.language) に登録する。
    //
    // **base に markdownLanguage を渡して GFM を有効にする。**
    // 既定の base は CommonMark だけで、`- [ ] ` も `~~消し~~` も表 も
    // 構文木に出ない (TaskMarker / Strikethrough / Table のノードが無い)。
    // 本文の描画は remark-gfm で GFM として解釈している (markdownPipeline)
    // ので、エディタ側だけ CommonMark だと食い違う。
    //
    // これに気づいたのはライブプレビュー (docs/70) の実機確認 —
    // チェックボックスがウィジェットにならず、原因が構文木側だった。
    // 見えるところでは「装飾が付かない」形でしか出ないので気づきにくい
    const md = markdown({ base: markdownLanguage });
    const extensions = [
      md,
      // ```<言語> の補完 (basicSetup が autocompletion を既定で有効化済み)。
      // override せず language data 経由で登録し、組み込み補完と共存させる
      md.language.data.of({ autocomplete: fenceLanguageCompletion }),
      // circuitikz / mermaid の打ち間違いに警告を出す (補完だけでは
      // 入れ替わり誤字が無反応で確定してしまうため)
      fenceLanguageLinter,
      // ```quiz の中身の書き方 (docs/58 §2)。間違いに気づく場所が
      // 閲覧タブまで遠いので、編集中にその場で知らせる
      quizLinter,
      EditorView.lineWrapping,
      // 旧 textarea の maxLength 相当: 上限を超える変更を受け付けない
      EditorState.changeFilter.of((tr) => tr.newDoc.length <= MAX_TEXT_LENGTH),
      // ライブプレビューの差し込み口。中身の入れ替えは reconfigure で行い、
      // この配列の**参照は変えない** (参照が変わると拡張一式が組み直される)。
      //
      // **覚えてある設定はここで読む。** かつては常に OFF で組んでおいて
      // マウント時の effect で入れ直していたが、それでは効かなかった —
      // その時点では @uiw/react-codemirror がまだ view を作っておらず
      // (editorRef.current?.view が undefined)、dispatch が黙って捨てられる。
      // ボタンは ON の見た目なのに装飾が出ない、という形で出た (実機で確認)。
      // 拡張を組むこの場で読めば view の有無に関係なく最初から載り、
      // 一瞬だけ生記法が見える瞬間も無くなる。
      //
      // 描画中に localStorage を読むことになるが、この部品は ssr: false で
      // 読み込まれる (MemoEditor.tsx) ので hydration はずれない
      livePreviewCompartment.of(
        livePreviewContent(loadLivePreviewPref(browserStorage())),
      ),
      // ノート内検索 (docs/76 §3, §6)。検索状態・ハイライト・Ctrl+F を足す
      noteSearch.extension,
      // 添付のペースト・ドロップ (useAttachmentInsert)
      fileEvents,
    ];
    return { extensions, livePreviewCompartment, noteSearch };
    // fileEvents は useAttachmentInsert が参照を固定して渡すので、依存に
    // 載せても組み直しは起きない (編集画面につき一度だけ組む)
  }, [fileEvents]);

  // 書式メニューで選んだ記法を選択範囲へ掛ける (docs/70 §6)。
  // 何を変えるかは markdownFormat が決め、ここは反映と後始末だけ。
  // **focus を戻す**のが要点 — メニューのボタンを押した時点でエディタは
  // フォーカスを失っており、戻さないと続けて打てない (選択も見えなくなる)
  const applyFormat = (action: FormatAction) => {
    const view = editorRef.current?.view;
    if (!view) {
      return;
    }
    view.dispatch(formatSpec(view.state, action));
    view.focus();
  };

  // ＋ で新しいページを足す (docs/74-ページ計画.md §5)。
  //
  // **区切り行を 1 つ挿すだけ**。本文は 1 枚のままなので、undo 履歴も
  // ライブプレビューもツールバーも今までどおり動く (ページごとに value を
  // 差し替える作りにしない理由は計画 §5)。
  //
  // notePages は remark を引き込むので、押すまで読み込まない (お絵かき・
  // スキャナと同じ流儀)。本文は **await の後に**読み直す — 読み込みを待つ
  // 間に打鍵が続いても、位置が古い本文のままにならないように
  const addPage = async () => {
    try {
      const { newPageInsertion } = await import("@/components/notePages");
      const view = editorRef.current?.view;
      if (!view) {
        return;
      }
      const { from, to, insert, cursor } = newPageInsertion(
        view.state.doc.toString(),
        view.state.selection.main.head,
      );
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: cursor },
        scrollIntoView: true,
      });
      view.focus();
    } catch (e) {
      // **黙って諦めない。** chunk の取得は電波が細いときに落ちるし、再デプロイ
      // で古い hash の chunk が消えた画面を開いたままでも落ちる。放っておくと
      // 「押したのに区切りが入らない」だけになり (コンソールの unhandled
      // rejection しか残らない)、この画面の他の失敗と違って手掛かりが無い。
      // 生のメッセージは英語で判じ物なので、まず日本語で言って括弧に添える
      setError(
        `ページを追加できませんでした。通信を確かめ、画面を再読み込みしてから試して下さい (${
          errorText(e)
        })`,
      );
    }
  };

  // ライブプレビューの ON/OFF。Compartment の中身だけを入れ替えるので、
  // 拡張一式の組み直しも本文への書き込みも起きない (履歴に 1 手も積まれない)
  const toggleLivePreview = () => {
    const next = !livePreview;
    setLivePreview(next);
    saveLivePreviewPref(browserStorage(), next);
    const view = editorRef.current?.view;
    if (view) {
      view.dispatch({
        effects: livePreviewCompartment.reconfigure(livePreviewContent(next)),
      });
    }
  };

  // ここからノート内検索・置換 (docs/76-ノート内検索計画.md)。
  //
  // 探す計算は noteSearch.ts、帯の見た目は NoteSearchBar.tsx、CodeMirror 側の
  // ハイライトと鍵は noteSearchHighlight.ts。ここはその 3 つを繋ぐだけ。

  // ライブプレビューを検索中だけ畳む (§4)。記法を隠した範囲は DOM に無く、
  // そこに当たった一致はハイライトが出ないまま「何も無い所」へ飛ぶ。
  // **設定 (localStorage) は書き換えない** — 閉じれば元の見え方に戻る
  const setLivePreviewSuspended = (suspended: boolean) => {
    const view = editorRef.current?.view;
    if (!view || !livePreview) {
      return; // もともと OFF なら触るものがない
    }
    view.dispatch({
      effects: livePreviewCompartment.reconfigure(
        livePreviewContent(!suspended),
      ),
    });
  };

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
    // 選んでからボタンを押したなら、その語を初期値にする (短い 1 行のときだけ。
    // 長い範囲は帯に収まらず、消して打ち直す手間が増える)
    const selected = view
      ? view.state.sliceDoc(
          view.state.selection.main.from,
          view.state.selection.main.to,
        )
      : "";
    const seed =
      selected.length > 0 &&
      selected.length <= FIND_SEED_MAX &&
      !selected.includes("\n")
        ? selected
        : find.search;
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
    // 控えるのは dispatch の**後**。dispatch の中で handleUpdate が走るので、
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
    const bar = hostEl?.getBoundingClientRect().height ?? 0;
    const viewport = window.visualViewport;
    // iOS はキーボードでレイアウトの高さを変えない (visualViewport だけが縮む)。
    // その差がキーボードの高さ
    const keyboard = viewport
      ? Math.max(0, window.innerHeight - viewport.height)
      : 0;
    return bar + keyboard + FIND_SCROLL_GAP;
  };

  // 鍵 (Ctrl+F / F3 / Escape) とスクロール余白から呼ばれる口を、毎描画で
  // 今の関数に差し替える。**依存配列は付けない** — 下の関数は毎描画で作り
  // 直され、掴んでいる state (findOpen・find) もそのつど変わるため。
  //
  // 拡張は一度しか組まない (useMemo) ので、ここを通さないと「マウント時の
  // 関数」を永久に掴んだままになる (押しても閉じた状態のまま動く)
  useEffect(() => {
    noteSearch.update({
      onOpen: openFind,
      onFindNext: () => runFind(findNext),
      onFindPrev: () => runFind(findPrevious),
      onEscape: closeFind,
      bottomMargin: findBottomMargin,
    });
  });

  // undo / redo をボタンから呼ぶ。モバイルには Ctrl+Z がないため
  const runHistoryCommand = (command: (view: EditorView) => boolean) => {
    const view = editorRef.current?.view;
    if (view) {
      command(view);
      view.focus();
    }
  };

  // 履歴の深さが変わったときだけボタンの活殺を更新する。
  // onUpdate はカーソル移動でも呼ばれるので、同じ値なら前の state を
  // 返して再レンダリングを止める。
  // **参照を固定する** — CodeMirror はこの関数の参照が変わると拡張一式を
  // 組み直す (BASIC_SETUP のコメント参照)
  const handleUpdate = useCallback((update: ViewUpdate) => {
    const next = {
      canUndo: undoDepth(update.state) > 0,
      canRedo: redoDepth(update.state) > 0,
    };
    setHistory((prev) =>
      prev.canUndo === next.canUndo && prev.canRedo === next.canRedo
        ? prev
        : next,
    );

    // 本文が動いたら全置換の「元に戻す」を下げる (docs/76 §5-2)。undo が戻すのは
    // いちばん新しい手なので、動いた後にも押させると置換ではなく打鍵が戻る。
    // **知らせの文 (「3 件置換しました」) は残す** — 消すと、押して戻ったのだと
    // 誤解される形に近づく。何件置換したかは読めたままにしておく
    if (update.docChanged && replacedDocRef.current) {
      replacedDocRef.current = null;
      setFindNote((prev) => (prev?.undo ? { ...prev, undo: false } : prev));
    }

    // シークレットのボタン文字 (docs/52-シークレット編集導線計画.md §1)。
    // **本文かカーソルが動いたときだけ**数える。onUpdate は再描画や
    // フォーカスでも呼ばれるので、そのたびに全文を走査する必要はない。
    // 履歴と同じく、変わったときだけ setState して再レンダリングを止める
    if (update.docChanged || update.selectionSet) {
      const label = secretToolbarLabel(
        update.state.doc.toString(),
        update.state.selection.main.from,
      );
      setSecretLabel((prev) => (prev === label ? prev : label));

      // 検索の件数と「何番目か」(docs/76 §2)。本文を直しても、次の一致へ
      // 送っても、置換しても必ずここを通る — 数え直す場所を 1 つにしておく。
      // 検索条件は ref から読む (state にすると、この関数の参照が変わって
      // 拡張一式が組み直される)
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

  // 「更新」は下部バーへ portal されており、DOM は form の外に出る。native の
  // submit ボタンの関連付けは効かないので、囲みの form を明示的に送信する。
  // form は編集エリア (wrapperRef) から辿る — こちらは form の DOM 内にある
  const submitForm = () => {
    wrapperRef.current?.closest("form")?.requestSubmit();
  };

  // シークレット (docs/51-部分暗号化計画.md §8, §12)。
  //
  // カーソルがシークレット記法の上なら**その断片を開く** (編集)。そうでなければ
  // **選択範囲を引き継いで新規**にする — これが既存平文の移行導線そのもので、
  // 選んだ範囲がそのまま暗号化され、記法に置き換わる。
  //
  // 平文がここから memo の state へ入ることはない。ダイアログは自分の中だけで
  // 文字を持ち、封をしてから戻ってくる (記法だけが本文に入る)。
  const openSecret = () => {
    const view = editorRef.current?.view;
    if (!view) {
      return;
    }
    const { from, to } = view.state.selection.main;
    const hit = secretAtCursor(view.state.doc.toString(), from);
    setSecret(
      hit
        ? { name: hit.name, text: "", label: hit.label }
        : { name: null, text: view.state.doc.sliceString(from, to), label: "" },
    );
  };

  // 封が済んだ断片を本文へ反映する。
  //
  // 新規は選択範囲を記法で置き換え、編集は**名前で引き直した位置**の記法を
  // 差し替える (ラベルを変えたときのため)。位置ではなく名前で引くので、
  // ダイアログを開いている間に本文が動いていても正しい場所に当たる。
  const applySecret = (name: string, label: string) => {
    const editing = secret !== null && secret.name !== null;
    setSecret(null);
    const view = editorRef.current?.view;
    if (!view) {
      return;
    }
    const notation = secretNotation(label, name);

    if (!editing) {
      insertText(view, notation);
      return;
    }

    const hit = findSecretNotation(view.state.doc.toString(), name);
    if (hit) {
      view.dispatch({ changes: { from: hit.from, to: hit.to, insert: notation } });
    } else {
      // 利用者が記法ごと消していた。中身は保存済みなので、参照を入れ直す
      insertText(view, notation);
    }
    view.focus();
  };

  return (
    <div ref={wrapperRef} className="space-y-2">
      <div className="overflow-hidden rounded border border-gray-300 bg-white">
        <CodeMirror
          ref={editorRef}
          value={value}
          onChange={onChange}
          extensions={extensions}
          autoFocus={autoFocus}
          minHeight={minHeight}
          placeholder="メモを入力して下さい。"
          basicSetup={BASIC_SETUP}
          onUpdate={handleUpdate}
        />
      </div>
      {/* 操作ボタンは下部バーへ portal した (EditToolbar)。エディタ直下には
          文字数と補足だけを残す — バナー類 (エラー・録音/録画/OCR の知らせ) も
          打鍵中に見える本文の近くに置く */}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {/* ペースト・ドラッグ&ドロップは実質デスクトップの操作なので、
            幅が狭いときは畳む */}
        <span className="hidden text-gray-400 sm:inline">
          画像・音声・動画・PDF はペースト・ドラッグ&ドロップでも挿入できます
        </span>
        <span
          className={`ml-auto ${
            value.length >= MAX_TEXT_LENGTH
              ? "font-bold text-red-600"
              : "text-gray-400"
          }`}
        >
          {value.length.toLocaleString()} / {MAX_TEXT_LENGTH.toLocaleString()}
        </span>
      </div>
      {error && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {/* 自動停止の知らせ。押していないのに止まった理由が判らないと、
          録音が切れた原因を探せない */}
      {recording.note && (
        <BusyNotice aria-live="polite">{recording.note}</BusyNotice>
      )}
      {/* 録画は全画面モーダルで行う (プレビュー・録画・カメラ操作すべて)。
          state と操作は videoRecording が持ち、ここは開閉のきっかけだけ */}
      <VideoRecordModal video={videoRecording} />
      {videoRecording.note && (
        <BusyNotice aria-live="polite">{videoRecording.note}</BusyNotice>
      )}
      {ocr.ocrNote && (
        <BusyNotice
          aria-live="polite"
          aria-busy={ocr.ocrCount > 0}
          busy={ocr.ocrCount > 0}
        >
          {ocr.ocrNote}
          {/* % は aria-hidden で足す: aria-live が毎ティック読み上げないように */}
          {ocr.modelPercent !== null && (
            <span aria-hidden> {ocr.modelPercent}%</span>
          )}
        </BusyNotice>
      )}
      {/* 編集中スキャンの取得中・結果 (OCR と同じ赤バナー) */}
      {scan.scanNote && (
        <BusyNotice
          aria-live="polite"
          aria-busy={scan.scanBusy}
          busy={scan.scanBusy}
        >
          {scan.scanNote}
        </BusyNotice>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_FILE_TYPES}
        multiple
        hidden
        onChange={(e) => handleFilePick(e.target.files)}
      />
      {drawings.drawing && (
        <DrawModal
          sourceImageUrl={drawings.drawing.sourceImageUrl}
          onCancel={drawings.closeDrawing}
          onInsert={drawings.insertDrawing}
        />
      )}
      {/* シークレットの入力。**本文の state を経由しない** — ここで書いた
          平文は封をしてからでないと外へ出ない (docs/51 §8) */}
      {secret && (
        <SecretDialog
          name={secret.name}
          initialText={secret.text}
          initialLabel={secret.label}
          onSaved={applySecret}
          onClose={() => setSecret(null)}
        />
      )}
      {/* 編集中スキャン: 読み取った生値を runScanInsert へ渡すだけ (検索しない) */}
      {scan.scanning && (
        <ScannerModal
          title="書籍・商品バーコードをかざす"
          onClose={scan.closeScanner}
          onResult={(rawValue) => void scan.runScanInsert(rawValue)}
        />
      )}
      {/* 操作ボタンを下部バーの差し込み口へ portal する。差し込み口が出来る
          まで hostEl は null (表向きのタブでない間も null)。portal は React
          ツリーの親子を保つので、更新ボタンの useFormStatus は囲みの form を
          拾い、各ハンドラは上の state/ref を触れる。
          **検索中はツールバーの代わりに検索バーを出す** (docs/76 §2) —
          並べると帯が 2 段になり、狭い画面で本文が潰れる */}
      {hostEl &&
        findOpen &&
        createPortal(
          <NoteSearchBar
            search={find.search}
            replace={find.replace}
            caseSensitive={find.caseSensitive}
            showReplace={find.showReplace}
            count={findCount}
            note={findNote}
            onSearchChange={(search) => applyFind({ ...find, search }, true)}
            // 置換後の文字を変えても本文は動かない (飛ばない)
            onReplaceChange={(replace) =>
              applyFind({ ...find, replace }, false)
            }
            onToggleCase={() =>
              applyFind({ ...find, caseSensitive: !find.caseSensitive }, true)
            }
            onToggleReplace={() =>
              setFind({ ...find, showReplace: !find.showReplace })
            }
            onFindNext={() => runFind(findNext)}
            onFindPrev={() => runFind(findPrevious)}
            onReplaceOne={replaceOne}
            onReplaceAll={replaceAll}
            onUndo={undoReplace}
            onClose={closeFind}
          />,
          hostEl,
        )}
      {hostEl &&
        !findOpen &&
        createPortal(
          <EditToolbar
            onSubmit={submitForm}
            canUndo={history.canUndo}
            canRedo={history.canRedo}
            onUndo={() => runHistoryCommand(undo)}
            onRedo={() => runHistoryCommand(redo)}
            uploadLabel={uploadButtonLabel(upload)}
            uploading={uploading}
            onInsertFile={openFilePicker}
            onPasteClipboard={importClipboard}
            scanLabel={scan.scanBusy ? "取得中" : "スキャン"}
            onScan={scan.openScanner}
            recordLabel={recordButtonLabel(
              recording.isRecording,
              recording.elapsedMs,
            )}
            isRecording={recording.isRecording}
            // 録音中だけは busy でも押せる。止められないと録音が終わらない
            recordDisabled={busy && !recording.isRecording}
            onToggleRecord={recording.toggle}
            onRecordVideo={videoRecording.openPreview}
            onDraw={drawings.openDrawing}
            ocrLabel={ocrButtonLabel(ocr.ocrCount)}
            onOcr={() => void ocr.runOcrAtCursor()}
            secretLabel={secretLabel}
            onSecret={openSecret}
            livePreview={livePreview}
            onToggleLivePreview={toggleLivePreview}
            onFormat={applyFormat}
            onAddPage={() => void addPage()}
            onFind={openFind}
            busy={busy}
          />,
          hostEl,
        )}
    </div>
  );
}
