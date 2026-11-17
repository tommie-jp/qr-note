"use client";

import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PanelActiveContext } from "@/components/editor/PanelActiveContext";
import {
  NoteChromePanel,
  NoteChromeTrigger,
} from "@/components/notechrome/NoteChromeOverlay";
import { useNoteChrome } from "@/components/notechrome/NoteChromeProvider";
import { noteChromeLayout, useNoteChromePinned } from "@/lib/prefs/noteChrome";

// 既定の 3 つに、モジュールが足すタブ (extraTabs の key) が加わる
type MemoMode = "markdown" | "text" | "edit" | (string & {});

// モジュールが足すタブ (docs/126 §1-4。登録は src/modules/registry.tsx)。
// 中身は編集タブと同じく「書く場所」として扱う (見出し行を畳まない)
export interface ExtraTab {
  key: string;
  label: string;
  content: ReactNode;
}

interface MemoPanelProps {
  defaultMode: MemoMode;
  markdownView: ReactNode;
  textView: ReactNode;
  // 省略 = 読み取り専用 (公開ビュー。docs/22-ノート公開計画.md §4)。
  // 編集タブごと出さない — /edit も Server Action も未ログインには閉じているので、
  // 押しても何も起きないタブを見せない
  editForm?: ReactNode;
  // タブの周りに置くノートの操作 (docs/108-ノート全画面表示計画.md)。
  // 省略 = タブだけ (これまでの形)。渡すと、畳める器 (NoteChromeProvider)
  // の中では読むタブの間だけ畳み、呼ばれたときに上端の行の下へ重ねる
  chrome?: NoteChrome;
  // 4 つ目以降のタブ (予定など)。編集タブの右に並ぶ
  extraTabs?: readonly ExtraTab[];
}

export interface NoteChrome {
  // 見出し行 (番号・トグル・操作リンク)
  heading: ReactNode;
  // 畳まない物 (未登録・ゴミ箱のバナー、URL の箱)。畳んでいる間も本文の上に出す
  notices: ReactNode;
  tags: ReactNode;
  // 作成・更新の時刻
  footer: ReactNode;
  // 畳んでいる間、呼び口 (⋯) の左に出す印 (公開中)
  badge?: ReactNode;
}

const MODES: { key: MemoMode; label: string }[] = [
  { key: "markdown", label: "markdown" },
  { key: "text", label: "テキスト" },
  { key: "edit", label: "編集" },
];

type ModeTab = { key: MemoMode; label: string };

// タブの選択と「一度開いたタブ」の控え。足したタブが消えたら markdown へ戻す
function useMemoTabs({
  defaultMode,
  hasEditForm,
  extraTabs,
}: {
  defaultMode: MemoMode;
  hasEditForm: boolean;
  extraTabs: readonly ExtraTab[];
}) {
  const [mode, setMode] = useState<MemoMode>(defaultMode);
  const [visited, setVisited] = useState<ReadonlySet<MemoMode>>(
    () => new Set([defaultMode]),
  );

  const selectMode = (key: MemoMode) => {
    setMode(key);
    setVisited((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  };

  // 読み取り専用なら編集タブは出さない (editForm 省略時)
  const modes: ModeTab[] = [
    ...MODES.filter(({ key }) => key !== "edit" || hasEditForm),
    ...extraTabs.map(({ key, label }) => ({ key, label })),
  ];
  // 足したタブが消えた (本文から date= を消した等) ら markdown へ戻す
  const shownMode = modes.some(({ key }) => key === mode) ? mode : "markdown";
  return { visited, selectMode, modes, shownMode };
}

// 畳める器 (NoteChromeProvider) の中での形 (積む / 畳む) を決め、器へ伝える
function useChromeLayout({
  hasChrome,
  editing,
}: {
  hasChrome: boolean;
  editing: boolean;
}) {
  const host = useNoteChrome();
  const pinned = useNoteChromePinned();
  const layout = noteChromeLayout({
    collapsible: hasChrome && host !== null,
    pinned,
    editing,
  });
  const dismiss = host?.dismiss;
  const setInline = host?.setInline;

  // 積む形へ移ったら、⋯ で開いていた分を捨てる。残すと、次に畳んだ瞬間に
  // 誰も呼んでいないのに面が開いて出てくる
  useEffect(() => {
    if (layout === "inline") {
      dismiss?.();
    }
  }, [layout, dismiss]);

  // 器に「いま積む形か」を知らせる。帯はこれを見て、畳む形のときだけ本文の上に
  // 浮く (docs/108 §3-6)。chrome を持たない (畳めない) 使い方では積む形でも
  // 知らせない — 畳めない器は浮かせる口も持たない。
  // useLayoutEffect … サーバ描画は浮いた形 (既定) で届くので、積む形で始まる
  // ノート (空のメモは編集タブ・「常に出す」の端末) は描いた直後に行へ戻す。
  // 描画後の effect だと戻る前の 1 フレームが見えて本文が 48px 跳ねる。
  // 後始末で畳む形に戻すのは、器 (NoteChromeProvider) がパネルより長生きする
  // ことがあるため (自動で選ぶペインは itemId で key を付けない)
  useLayoutEffect(() => {
    if (!hasChrome) {
      return;
    }
    setInline?.(layout === "inline");
    return () => setInline?.(false);
  }, [hasChrome, layout, setInline]);

  return { host, inline: layout === "inline", dismiss };
}

// memo の表示切替タブ。中身 (markdownView / textView / editForm) は
// Server Component のまま slot として受け取る。
// パネルは「一度開いたら hidden で保持」: 開くまでマウントしないことで
// 重い中身 (CodeMirror, mermaid) の読み込みを遅延し、開いた後は
// unmount しないことで編集中の入力を保持する
export function MemoPanel({
  defaultMode,
  markdownView,
  textView,
  editForm,
  chrome,
  extraTabs = [],
}: MemoPanelProps) {
  const { visited, selectMode, modes, shownMode } = useMemoTabs({
    defaultMode,
    hasEditForm: editForm !== undefined,
    extraTabs,
  });
  const { host, inline, dismiss } = useChromeLayout({
    hasChrome: chrome !== undefined,
    editing: shownMode === "edit" || extraTabs.some(({ key }) => key === shownMode),
  });

  const panels = panelsOf({ markdownView, textView, editForm, extraTabs });
  const tabPanels = (
    <TabPanels panels={panels} visited={visited} shownMode={shownMode} />
  );
  const tabs = <MemoTabs modes={modes} mode={shownMode} onSelect={selectMode} />;

  if (chrome === undefined) {
    return (
      <div className="space-y-2">
        {tabs}
        {tabPanels}
      </div>
    );
  }

  return (
    <ChromedPanel
      chrome={chrome}
      inline={inline}
      host={host}
      tabs={tabs}
      tabPanels={tabPanels}
      modes={modes}
      shownMode={shownMode}
      // 重ねた面からタブを選んだら面を閉じる (選んだ中身を読みに行くため)。
      // 編集を選んだときは積む形に変わるので、閉じても戻り口は残る
      onOverlaySelect={(key) => {
        selectMode(key);
        dismiss?.();
      }}
    />
  );
}

type Panel = { key: MemoMode; content: ReactNode };

// 中身の並び。読み取り専用 (editForm 省略) なら編集タブの中身は無い
function panelsOf({
  markdownView,
  textView,
  editForm,
  extraTabs,
}: Pick<MemoPanelProps, "markdownView" | "textView" | "editForm"> & {
  extraTabs: readonly ExtraTab[];
}): Panel[] {
  return [
    { key: "markdown", content: markdownView },
    { key: "text", content: textView },
    ...(editForm === undefined
      ? []
      : [{ key: "edit" as const, content: editForm }]),
    ...extraTabs.map(({ key, content }) => ({ key, content })),
  ];
}

// 畳める器の中のパネル。積む形 (inline) と畳む形の両方を描く
function ChromedPanel({
  chrome,
  inline,
  host,
  tabs,
  tabPanels,
  modes,
  shownMode,
  onOverlaySelect,
}: {
  chrome: NoteChrome;
  inline: boolean;
  host: ReturnType<typeof useNoteChrome>;
  tabs: ReactNode;
  tabPanels: ReactNode;
  modes: readonly ModeTab[];
  shownMode: MemoMode;
  onOverlaySelect: (key: MemoMode) => void;
}) {
  // **積む形と畳む形で木の形を変えない。** 編集タブに入ると積む形へ、出ると
  // 畳む形へ切り替わるので、パネルの親や位置が変わると React はパネルを
  // 作り直す — 開いたエディタが捨てられ、打ちかけの文字・undo の履歴・
  // 離脱の確認が消える (レビューで判明)。出さない物は null の穴にして、
  // パネルの器はどちらの形でも同じ位置の同じ div に置く
  return (
    <div>
      {inline ? chrome.heading : null}
      {chrome.notices}
      {inline ? chrome.tags : null}
      <div className={inline ? "space-y-2" : undefined}>
        {inline ? tabs : null}
        {tabPanels}
      </div>
      {/* 本文と地続きだと日時が本文の続きに見えるので、ここだけ間隔を残す */}
      {inline ? <div className="mt-4">{chrome.footer}</div> : null}
      {inline ? null : (
        <CollapsedChrome
          chrome={chrome}
          host={host}
          modes={modes}
          shownMode={shownMode}
          onSelect={onOverlaySelect}
        />
      )}
    </div>
  );
}

// 中身のパネル。一度開いたタブは hidden で保持する
function TabPanels({
  panels,
  visited,
  shownMode,
}: {
  panels: readonly Panel[];
  visited: ReadonlySet<MemoMode>;
  shownMode: MemoMode;
}) {
  return panels.map(
    ({ key, content }) =>
      // 表に出ているタブは必ず描く (足したタブが消えて markdown へ戻ったとき、
      // markdown をまだ一度も開いていないことがある)
      (visited.has(key) || key === shownMode) && (
        // data-os-menu … スマホの長押しで OS のメニュー (コピー・共有) を
        // 出すのはこの中だけ (globals.css。docs/98)。読む・書く場所なので
        // 文字の選択も画像の共有も要る。上のタブの見出しは押す物なので外す
        <div key={key} hidden={shownMode !== key} data-os-menu="">
          {/* いま表向きのタブかを中身へ伝える。編集タブの操作ボタンは下部バーへ
              portal され hidden の枠を抜けるので、非表示タブでは portal を
              止める必要がある (MemoEditorInner が参照する) */}
          <PanelActiveContext.Provider value={shownMode === key}>
            {content}
          </PanelActiveContext.Provider>
        </div>
      ),
  );
}

// 畳む形。操作は上端の行の差し込み口へ portal する — React の木の上では
// このパネルの子のままなので、タブの状態はそのまま使える (docs/108 §3-2)。
// 差し込み口は描いた後にしか無いので、サーバ描画では操作が 1 つも出ない
function CollapsedChrome({
  chrome,
  host,
  modes,
  shownMode,
  onSelect,
}: {
  chrome: NoteChrome;
  host: ReturnType<typeof useNoteChrome>;
  modes: readonly ModeTab[];
  shownMode: MemoMode;
  onSelect: (key: MemoMode) => void;
}) {
  return (
    <>
      {host?.triggerSlot
        ? createPortal(
            <NoteChromeTrigger badge={chrome.badge} />,
            host.triggerSlot,
          )
        : null}
      {host?.revealed && host.overlaySlot
        ? createPortal(
            <NoteChromePanel>
              {chrome.heading}
              {chrome.tags}
              <div className="pt-2">
                <MemoTabs modes={modes} mode={shownMode} onSelect={onSelect} />
              </div>
              <div className="mt-2">{chrome.footer}</div>
            </NoteChromePanel>,
            host.overlaySlot,
          )
        : null}
    </>
  );
}

// タブの見出し。積む形と重ねる面の両方で使う
function MemoTabs({
  modes,
  mode,
  onSelect,
}: {
  modes: readonly ModeTab[];
  mode: MemoMode;
  onSelect: (key: MemoMode) => void;
}) {
  return (
    // flex-wrap … テキストサイズ (docs/61) を上げると 3 つのタブが 1 行に
    // 収まらない。折り返さないと画面ごと横スクロールになる
    <div role="tablist" className="flex flex-wrap gap-1">
      {modes.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={mode === key}
          onClick={() => onSelect(key)}
          className={`min-h-10 rounded-t border border-b-0 px-4 transition-colors ${
            mode === key
              ? "border-gray-300 bg-white font-medium text-blue-600"
              : "border-transparent bg-gray-100 text-gray-500 active:bg-gray-200"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
