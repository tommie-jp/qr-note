"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PanelActiveContext } from "@/components/editor/PanelActiveContext";
import {
  NoteChromePanel,
  NoteChromeTrigger,
} from "@/components/notechrome/NoteChromeOverlay";
import { useNoteChrome } from "@/components/notechrome/NoteChromeProvider";
import { noteChromeLayout, useNoteChromePinned } from "@/lib/prefs/noteChrome";

type MemoMode = "markdown" | "text" | "edit";

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
}: MemoPanelProps) {
  const [mode, setMode] = useState<MemoMode>(defaultMode);
  const [visited, setVisited] = useState<ReadonlySet<MemoMode>>(
    () => new Set([defaultMode]),
  );

  const selectMode = (key: MemoMode) => {
    setMode(key);
    setVisited((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  };

  const panels: { key: MemoMode; content: ReactNode }[] = [
    { key: "markdown", content: markdownView },
    { key: "text", content: textView },
    ...(editForm === undefined
      ? []
      : [{ key: "edit" as const, content: editForm }]),
  ];

  // 読み取り専用なら編集タブは出さない (editForm 省略時)
  const modes = MODES.filter(
    ({ key }) => key !== "edit" || editForm !== undefined,
  );

  const host = useNoteChrome();
  const pinned = useNoteChromePinned();
  const layout = noteChromeLayout({
    collapsible: chrome !== undefined && host !== null,
    pinned,
    editing: mode === "edit",
  });
  const dismiss = host?.dismiss;

  // 積む形へ移ったら、⋯ で開いていた分を捨てる。残すと、次に畳んだ瞬間に
  // 誰も呼んでいないのに面が開いて出てくる
  useEffect(() => {
    if (layout === "inline") {
      dismiss?.();
    }
  }, [layout, dismiss]);

  // 重ねた面からタブを選んだら面を閉じる (選んだ中身を読みに行くため)。
  // 編集を選んだときは積む形に変わるので、閉じても戻り口は残る
  const selectFromOverlay = (key: MemoMode) => {
    selectMode(key);
    dismiss?.();
  };

  const tabPanels = panels.map(
    ({ key, content }) =>
      visited.has(key) && (
        // data-os-menu … スマホの長押しで OS のメニュー (コピー・共有) を
        // 出すのはこの中だけ (globals.css。docs/98)。読む・書く場所なので
        // 文字の選択も画像の共有も要る。上のタブの見出しは押す物なので外す
        <div key={key} hidden={mode !== key} data-os-menu="">
          {/* いま表向きのタブかを中身へ伝える。編集タブの操作ボタンは下部バーへ
              portal され hidden の枠を抜けるので、非表示タブでは portal を
              止める必要がある (MemoEditorInner が参照する) */}
          <PanelActiveContext.Provider value={mode === key}>
            {content}
          </PanelActiveContext.Provider>
        </div>
      ),
  );

  if (chrome === undefined) {
    return (
      <div className="space-y-2">
        <MemoTabs modes={modes} mode={mode} onSelect={selectMode} />
        {tabPanels}
      </div>
    );
  }

  // **積む形と畳む形で木の形を変えない。** 編集タブに入ると積む形へ、出ると
  // 畳む形へ切り替わるので、パネルの親や位置が変わると React はパネルを
  // 作り直す — 開いたエディタが捨てられ、打ちかけの文字・undo の履歴・
  // 離脱の確認が消える (レビューで判明)。出さない物は null の穴にして、
  // パネルの器はどちらの形でも同じ位置の同じ div に置く
  const inline = layout === "inline";
  return (
    <div>
      {inline ? chrome.heading : null}
      {chrome.notices}
      {inline ? chrome.tags : null}
      <div className={inline ? "space-y-2" : undefined}>
        {inline ? (
          <MemoTabs modes={modes} mode={mode} onSelect={selectMode} />
        ) : null}
        {tabPanels}
      </div>
      {/* 本文と地続きだと日時が本文の続きに見えるので、ここだけ間隔を残す */}
      {inline ? <div className="mt-4">{chrome.footer}</div> : null}
      {/* 畳む形。操作は上端の行の差し込み口へ portal する — React の木の上では
          このパネルの子のままなので、タブの状態はそのまま使える (docs/108 §3-2)。
          差し込み口は描いた後にしか無いので、サーバ描画では操作が 1 つも出ない */}
      {!inline && host?.triggerSlot
        ? createPortal(
            <NoteChromeTrigger badge={chrome.badge} />,
            host.triggerSlot,
          )
        : null}
      {!inline && host?.revealed && host.overlaySlot
        ? createPortal(
            <NoteChromePanel>
              {chrome.heading}
              {chrome.tags}
              <div className="pt-2">
                <MemoTabs
                  modes={modes}
                  mode={mode}
                  onSelect={selectFromOverlay}
                />
              </div>
              <div className="mt-2">{chrome.footer}</div>
            </NoteChromePanel>,
            host.overlaySlot,
          )
        : null}
    </div>
  );
}

// タブの見出し。積む形と重ねる面の両方で使う
function MemoTabs({
  modes,
  mode,
  onSelect,
}: {
  modes: readonly { key: MemoMode; label: string }[];
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
