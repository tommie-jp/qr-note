"use client";

import type { ReactNode } from "react";
import {
  BoardEditIcon,
  DrawIcon,
  FindIcon,
  ImageInsertIcon,
  LivePreviewIcon,
  LockIcon,
  MicIcon,
  OcrIcon,
  PasteIcon,
  PlusIcon,
  RedoIcon,
  SaveIcon,
  ScanIcon,
  UndoIcon,
  VideoIcon,
} from "@/components/icons";
import { SubmitButton } from "@/components/chrome/SubmitButton";
import { useLongPress } from "@/components/item/row-actions/useLongPress";
import { FormatMenuButton } from "@/components/editor/FormatMenuButton";
import type { FormatAction } from "@/components/editor/markdownFormat";

// ノート編集の操作を下部バーへ差し込むツールバー (docs/31-下部操作バー計画.md の
// 続き)。MemoEditorInner の editor/EditorBottomBarPortal が createPortal で
// PageBottomBar の中へ入れる。
//
// 並びは ← → の右に「更新」を固定し、残り 7 つ (元に戻す/やり直す/画像/録音/録画/
// お絵かき/OCR) を横スクロールの帯にする。← → と更新は常に見え、片手で届く。
//
// 状態・ハンドラは editor/hooks/ のフックが持ち、MemoEditorInner がまとめた
// editor (EditToolbarEditor) を受け取って描くだけ。進捗
// (アップロード%・録音秒数・OCR件数) は progressLabels のラベル文字列で受ける。

// 横スクロール帯のツールボタン。flex-1 にはしない (等幅で潰すと 7 個入らない)。
// shrink-0 で自然幅を保ち、はみ出しは親の overflow-x-auto でスクロールさせる。
const TOOL_SLOT =
  "flex min-h-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded px-2 text-[0.625rem] font-medium leading-none whitespace-nowrap text-gray-700 transition-colors active:bg-gray-200/70 disabled:opacity-40 disabled:active:bg-transparent";

// 更新 (主ボタン)。青塗りで他と差別化する。送信中はスピナー
const SUBMIT_SLOT =
  "flex min-h-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded px-3 text-[0.625rem] font-semibold leading-none whitespace-nowrap bg-blue-600 text-white transition active:scale-95 disabled:opacity-60 disabled:active:scale-100";

// アイコンに機能色を与える (BottomActionBar の SlotIcon と同じ狙い)。
// flex … svg の下にベースラインの隙間が出ないように
function ToolIcon({ color, children }: { color: string; children: ReactNode }) {
  return <span className={`flex ${color}`}>{children}</span>;
}

// 横スクロール帯の 1 ボタン (アイコン + 文字)。帯のボタンは押したときの処理・
// 止める条件・トグルの押下状態だけが違うので、形はここで 1 度だけ書く。
//
// disabled … 渡さなければ止めない (ページ・装飾表示のように busy でも押せる物)。
// pressed … トグルだけが渡す。渡さなければ aria-pressed 自体を出さない —
// 「押されていない」と「トグルではない」は読み上げで別の意味になる
function ToolButton({
  icon,
  color,
  label,
  onClick,
  disabled,
  pressed,
}: {
  icon: ReactNode;
  color: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      className={TOOL_SLOT}
    >
      <ToolIcon color={color}>{icon}</ToolIcon>
      {label}
    </button>
  );
}

// ノート内検索 (docs/76-ノート内検索計画.md §2)。
//
// **タップで検索、長押しで置換つき**で開く。下部バーのスロット (docs/62) と
// 同じ割り当て — 短いタップに既定の動作があり、長押しはその先へ直接行く近道。
// 置換のためだけにボタンをもう 1 つ帯へ並べると、既に 12 個ある挿入系が
// さらにスクロールの奥へ押しやられる。
//
// 長押しが使えない環境 (キーボードだけ・読み上げ) では、帯を開いてから
// 中の「置換」ボタンで同じ所へ行ける。ここは近道であって唯一の道ではない
function FindButton({ onFind }: { onFind: (withReplace: boolean) => void }) {
  const press = useLongPress(() => onFind(true));
  return (
    <button
      type="button"
      {...press.handlers}
      onClick={(event) => {
        // 長押しが成立していた分の click は握り潰される (戻り値 true)。
        // そのまま続けると、置換つきで開いた直後に検索だけの状態へ
        // 上書きしてしまう
        if (press.handlers.onClick(event)) {
          return;
        }
        onFind(false);
      }}
      title="ノート内を検索 (長押しで置換)"
      className={TOOL_SLOT}
    >
      <ToolIcon color="text-blue-600">
        <FindIcon />
      </ToolIcon>
      検索
    </button>
  );
}

// ツールバーが描く・呼ぶもの一式。MemoEditorInner が editor/hooks/ のフックの
// 戻り値から組んで 1 つで渡す (docs/93-リファクタリング計画.md §5-1)。
// かつては 27 個の props に平たく並べていた
export interface EditToolbarEditor {
  // 更新: 囲みの form を送信する (useSubmitBlocker の submitForm)
  submit: () => void;
  // アップロード/OCR/録音中の共通 busy (録音以外のボタンを止める)
  busy: boolean;
  history: {
    canUndo: boolean;
    canRedo: boolean;
    undo: () => void;
    redo: () => void;
  };
  // 画像・音声・動画・PDF・テキストの挿入 (hidden file input を開く)
  upload: { label: string; uploading: boolean; open: () => void };
  // クリップボードから取り込む (docs/92-クリップボード連携計画.md §4)。
  // iPhone でコピーした写真を 1 タップで添付にする口。文字が入っていれば
  // 文字を挿す。**押した時点でしか読めない**ので、出し分けはしない
  pasteClipboard: () => void;
  // スキャン: バーコードを読んで書籍・商品情報をカーソル位置へ挿入する
  // (検索はしない)。ラベルは取得中に差し替わる
  scan: { label: string; open: () => void };
  // 録音 (トグル)。録音中は busy でも押せる (止められないと終わらない)
  record: {
    label: string;
    isRecording: boolean;
    disabled: boolean;
    toggle: () => void;
  };
  recordVideo: () => void;
  draw: () => void;
  ocr: { label: string; run: () => void };
  // シークレット挿入 (docs/51-部分暗号化計画.md §8)。選択範囲があれば
  // それを引き継いでダイアログを開く。
  // ラベルはカーソル位置で変わる (「秘密」/「秘密を編集」。docs/52 §1) —
  // 進捗ラベル (upload.label など) と同じく呼び出し側が文字列を作る
  secret: { label: string; open: () => void };
  // ライブプレビューの ON/OFF (docs/70-編集ライブプレビュー計画.md §4)。
  // 表示の切り替えだけなので busy でも押せる — 本文にもアップロードにも
  // 触らないため、処理中に止める理由がない
  livePreview: { on: boolean; toggle: () => void };
  // 書式メニュー (docs/70 §6)。選択範囲へ記法を付け外しするだけなので
  // busy でも押せる (アップロードにも通信にも触らない)
  format: (action: FormatAction) => void;
  // 新しいページを足す (docs/74-ページ計画.md §5)。区切り行を 1 つ挿すだけの
  // 本文編集なので、書式と同じく busy でも押せる
  addPage: () => void;
  // ノート内検索を開く (docs/76 §2)。引数は置換行も開くか (長押し)。
  // 本文を読むだけなので busy でも押せる
  find: (withReplace: boolean) => void;
  // 図を掴んで動かす殻を開く (docs/99-フェンスGUI編集計画.md)。
  // enabled はカーソルが実体配線図のフェンスの中にあるか — 秘密のラベルと
  // 同じく onUpdate で数え直す。閉じるときに本文へ当てるので busy では止める
  // (アップロード中の印の書き換えと食い違うと当てられない)
  fenceGui: { enabled: boolean; open: () => void };
}

export function EditToolbar({ editor }: { editor: EditToolbarEditor }) {
  const { busy, history, upload, scan, record, ocr, secret, livePreview } =
    editor;
  return (
    <>
      {/* ← → の右に固定する主ボタン。useFormStatus は囲みの <form> の子孫
          (portal はツリー親子を保つ) でしか pending を拾えないので、送信中の
          表示は SubmitButton に任せる。portal で DOM は form の外に出るため、
          送信は onClick で form.requestSubmit() を明示的に呼ぶ */}
      <SubmitButton
        onClick={editor.submit}
        overrideClassName={SUBMIT_SLOT}
        icon={<SaveIcon />}
        pendingLabel="更新中"
      >
        更新
      </SubmitButton>

      {/* 書式だけ横スクロール帯の**外**に出す。
          帯は overflow-x-auto を持ち、CSS の規定で片方が visible でなくなると
          もう片方 (overflow-y) も visible ではなくなる = auto になる。
          メニューは帯の上端より上へ開くので、中に置くと切り取られて
          何も出ないように見える (実機で発生)。
          常に見える位置になるのは書式にとってむしろ好都合 — 打鍵の合間に
          使うもので、スクロールの奥にあると届きにくい */}
      <FormatMenuButton onFormat={editor.format} className={TOOL_SLOT} />

      {/* 残りは横スクロール。min-w-0 で親の中で縮めてスクロールを効かせる */}
      <div className="flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto">
        <ToolButton
          icon={<UndoIcon />}
          color="text-gray-500"
          label="元に戻す"
          onClick={history.undo}
          disabled={!history.canUndo}
        />
        <ToolButton
          icon={<RedoIcon />}
          color="text-gray-500"
          label="やり直す"
          onClick={history.redo}
          disabled={!history.canRedo}
        />
        {/* ノート内検索 (docs/76 §2)。打鍵の合間に使うものなので、
            undo/redo の隣 (帯の前寄り) に置く */}
        <FindButton onFind={editor.find} />
        {/* 図を編集 (docs/99)。打鍵の合間に「いま書いている図」を開くものなので、
            検索と同じく帯の前寄りに置く */}
        <ToolButton
          icon={<BoardEditIcon />}
          color="text-lime-700"
          label="図を編集"
          onClick={editor.fenceGui.open}
          disabled={busy || !editor.fenceGui.enabled}
        />
        {/* 新しいページ (docs/74-ページ計画.md §5)。書式と違いメニューを
            開かないので、帯の中に置いても切り取られる物が無い。挿入系の
            前寄りに置くのは、打鍵の合間に使うため */}
        <ToolButton
          icon={<PlusIcon />}
          color="text-emerald-600"
          label="ページ"
          onClick={editor.addPage}
        />
        <ToolButton
          icon={<ScanIcon />}
          color="text-sky-600"
          label={scan.label}
          onClick={scan.open}
          disabled={busy}
        />
        <ToolButton
          icon={<ImageInsertIcon />}
          color="text-violet-600"
          label={upload.label}
          onClick={upload.open}
          disabled={upload.uploading}
        />
        {/* クリップボードから取り込む (docs/92 §4)。**画像ボタンの隣**に置く —
            どちらも「外から持ってきたものを添付にする」操作で、探す場所が
            同じであってほしい */}
        <ToolButton
          icon={<PasteIcon />}
          color="text-cyan-600"
          label="貼り付け"
          onClick={editor.pasteClipboard}
          disabled={busy}
        />
        <ToolButton
          icon={
            // 録音中は赤い点を重ねて「録れている」ことを示す (従来踏襲)
            record.isRecording ? (
              <span
                aria-hidden
                className="size-6 flex items-center justify-center"
              >
                <span className="size-2.5 animate-pulse rounded-full bg-rose-600" />
              </span>
            ) : (
              <MicIcon />
            )
          }
          color="text-rose-600"
          label={record.label}
          onClick={record.toggle}
          disabled={record.disabled}
          pressed={record.isRecording}
        />
        <ToolButton
          icon={<VideoIcon />}
          color="text-orange-600"
          label="録画"
          onClick={editor.recordVideo}
          disabled={busy}
        />
        <ToolButton
          icon={<DrawIcon />}
          color="text-emerald-600"
          label="お絵かき"
          onClick={editor.draw}
          disabled={busy}
        />
        <ToolButton
          icon={<OcrIcon />}
          color="text-teal-600"
          label={ocr.label}
          onClick={ocr.run}
          disabled={busy}
        />
        <ToolButton
          icon={<LockIcon />}
          color="text-amber-600"
          label={secret.label}
          onClick={secret.open}
          disabled={busy}
        />
        {/* 表示の切り替えなので busy でも押せる (本文にも通信にも触らない)。
            帯の末尾に置くのは、一度決めたらあまり動かさない設定だから —
            打鍵中に使う挿入系のボタンを、スクロールの奥へ押しやらない */}
        <ToolButton
          icon={<LivePreviewIcon />}
          color={livePreview.on ? "text-blue-600" : "text-gray-500"}
          label={livePreview.on ? "記法を表示" : "装飾表示"}
          onClick={livePreview.toggle}
          pressed={livePreview.on}
        />
      </div>
    </>
  );
}
