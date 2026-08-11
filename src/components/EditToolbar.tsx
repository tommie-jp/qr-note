"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import {
  DrawIcon,
  FindIcon,
  ImageInsertIcon,
  LivePreviewIcon,
  LockIcon,
  MicIcon,
  OcrIcon,
  PlusIcon,
  RedoIcon,
  SaveIcon,
  ScanIcon,
  UndoIcon,
  VideoIcon,
} from "@/components/MenuIcons";
import { useLongPress } from "@/components/useLongPress";
import { FormatMenuButton } from "@/components/editor/FormatMenuButton";
import type { FormatAction } from "@/components/editor/markdownFormat";

// ノート編集の操作を下部バーへ差し込むツールバー (docs/31-下部操作バー計画.md の
// 続き)。MemoEditorInner が createPortal で PageBottomBar の中へ入れる。
//
// 並びは ← → の右に「更新」を固定し、残り 7 つ (元に戻す/やり直す/画像/録音/録画/
// お絵かき/OCR) を横スクロールの帯にする。← → と更新は常に見え、片手で届く。
//
// 状態・ハンドラは MemoEditorInner が持ち、ここは受け取って描くだけ。進捗
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

// 更新ボタン。useFormStatus は囲みの <form> の子孫 (portal はツリー親子を保つ)
// でしか pending を拾えないので、ここだけ独立させる (SubmitButton と同じ理由)。
// portal で DOM は form の外に出るため、submit の DOM 関連付けは使えない。
// onSubmit で form.requestSubmit() を明示的に呼ぶ (MemoEditorInner から渡す)。
function SubmitBarButton({ onSubmit }: { onSubmit: () => void }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="button"
      onClick={onSubmit}
      disabled={pending}
      aria-busy={pending}
      className={SUBMIT_SLOT}
    >
      {pending ? (
        <span
          aria-hidden
          className="size-6 animate-spin rounded-full border-2 border-white/40 border-t-white"
        />
      ) : (
        <SaveIcon />
      )}
      {pending ? "更新中" : "更新"}
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

export interface EditToolbarProps {
  // 更新: 囲みの form を送信する (MemoEditorInner が requestSubmit を渡す)
  onSubmit: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  // 画像・音声・動画・PDF・テキストの挿入 (hidden file input を開く)
  uploadLabel: string;
  uploading: boolean;
  onInsertFile: () => void;
  // スキャン: バーコードを読んで書籍・商品情報をカーソル位置へ挿入する
  // (検索はしない)。ラベルは取得中に差し替わる
  scanLabel: string;
  onScan: () => void;
  // 録音 (トグル)。録音中は busy でも押せる (止められないと終わらない)
  recordLabel: string;
  isRecording: boolean;
  recordDisabled: boolean;
  onToggleRecord: () => void;
  onRecordVideo: () => void;
  onDraw: () => void;
  ocrLabel: string;
  onOcr: () => void;
  // シークレット挿入 (docs/51-部分暗号化計画.md §8)。選択範囲があれば
  // それを引き継いでダイアログを開く。
  // ラベルはカーソル位置で変わる (「秘密」/「秘密を編集」。docs/52 §1) —
  // 進捗ラベル (uploadLabel など) と同じく呼び出し側が文字列を作る
  secretLabel: string;
  onSecret: () => void;
  // ライブプレビューの ON/OFF (docs/70-編集ライブプレビュー計画.md §4)。
  // 表示の切り替えだけなので busy でも押せる — 本文にもアップロードにも
  // 触らないため、処理中に止める理由がない
  livePreview: boolean;
  onToggleLivePreview: () => void;
  // 書式メニュー (docs/70 §6)。選択範囲へ記法を付け外しするだけなので
  // busy でも押せる (アップロードにも通信にも触らない)
  onFormat: (action: FormatAction) => void;
  // 新しいページを足す (docs/74-ページ計画.md §5)。区切り行を 1 つ挿すだけの
  // 本文編集なので、書式と同じく busy でも押せる
  onAddPage: () => void;
  // ノート内検索を開く (docs/76 §2)。引数は置換行も開くか (長押し)。
  // 本文を読むだけなので busy でも押せる
  onFind: (withReplace: boolean) => void;
  // アップロード/OCR/録音中の共通 busy (録音以外のボタンを止める)
  busy: boolean;
}

export function EditToolbar({
  onSubmit,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  uploadLabel,
  uploading,
  onInsertFile,
  scanLabel,
  onScan,
  recordLabel,
  isRecording,
  recordDisabled,
  onToggleRecord,
  onRecordVideo,
  onDraw,
  ocrLabel,
  onOcr,
  secretLabel,
  onSecret,
  livePreview,
  onToggleLivePreview,
  onFormat,
  onAddPage,
  onFind,
  busy,
}: EditToolbarProps) {
  return (
    <>
      {/* ← → の右に固定する主ボタン */}
      <SubmitBarButton onSubmit={onSubmit} />

      {/* 書式だけ横スクロール帯の**外**に出す。
          帯は overflow-x-auto を持ち、CSS の規定で片方が visible でなくなると
          もう片方 (overflow-y) も visible ではなくなる = auto になる。
          メニューは帯の上端より上へ開くので、中に置くと切り取られて
          何も出ないように見える (実機で発生)。
          常に見える位置になるのは書式にとってむしろ好都合 — 打鍵の合間に
          使うもので、スクロールの奥にあると届きにくい */}
      <FormatMenuButton onFormat={onFormat} className={TOOL_SLOT} />

      {/* 残りは横スクロール。min-w-0 で親の中で縮めてスクロールを効かせる */}
      <div className="flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto">
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          className={TOOL_SLOT}
        >
          <ToolIcon color="text-gray-500">
            <UndoIcon />
          </ToolIcon>
          元に戻す
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          className={TOOL_SLOT}
        >
          <ToolIcon color="text-gray-500">
            <RedoIcon />
          </ToolIcon>
          やり直す
        </button>
        {/* ノート内検索 (docs/76 §2)。打鍵の合間に使うものなので、
            undo/redo の隣 (帯の前寄り) に置く */}
        <FindButton onFind={onFind} />
        {/* 新しいページ (docs/74-ページ計画.md §5)。書式と違いメニューを
            開かないので、帯の中に置いても切り取られる物が無い。挿入系の
            前寄りに置くのは、打鍵の合間に使うため */}
        <button
          type="button"
          onClick={onAddPage}
          className={TOOL_SLOT}
        >
          <ToolIcon color="text-emerald-600">
            <PlusIcon />
          </ToolIcon>
          ページ
        </button>
        <button
          type="button"
          onClick={onScan}
          disabled={busy}
          className={TOOL_SLOT}
        >
          <ToolIcon color="text-sky-600">
            <ScanIcon />
          </ToolIcon>
          {scanLabel}
        </button>
        <button
          type="button"
          onClick={onInsertFile}
          disabled={uploading}
          className={TOOL_SLOT}
        >
          <ToolIcon color="text-violet-600">
            <ImageInsertIcon />
          </ToolIcon>
          {uploadLabel}
        </button>
        <button
          type="button"
          onClick={onToggleRecord}
          disabled={recordDisabled}
          aria-pressed={isRecording}
          className={TOOL_SLOT}
        >
          <ToolIcon color="text-rose-600">
            {/* 録音中は赤い点を重ねて「録れている」ことを示す (従来踏襲) */}
            {isRecording ? (
              <span
                aria-hidden
                className="size-6 flex items-center justify-center"
              >
                <span className="size-2.5 animate-pulse rounded-full bg-rose-600" />
              </span>
            ) : (
              <MicIcon />
            )}
          </ToolIcon>
          {recordLabel}
        </button>
        <button
          type="button"
          onClick={onRecordVideo}
          disabled={busy}
          className={TOOL_SLOT}
        >
          <ToolIcon color="text-orange-600">
            <VideoIcon />
          </ToolIcon>
          録画
        </button>
        <button
          type="button"
          onClick={onDraw}
          disabled={busy}
          className={TOOL_SLOT}
        >
          <ToolIcon color="text-emerald-600">
            <DrawIcon />
          </ToolIcon>
          お絵かき
        </button>
        <button
          type="button"
          onClick={onOcr}
          disabled={busy}
          className={TOOL_SLOT}
        >
          <ToolIcon color="text-teal-600">
            <OcrIcon />
          </ToolIcon>
          {ocrLabel}
        </button>
        <button
          type="button"
          onClick={onSecret}
          disabled={busy}
          className={TOOL_SLOT}
        >
          <ToolIcon color="text-amber-600">
            <LockIcon />
          </ToolIcon>
          {secretLabel}
        </button>
        {/* 表示の切り替えなので busy でも押せる (本文にも通信にも触らない)。
            帯の末尾に置くのは、一度決めたらあまり動かさない設定だから —
            打鍵中に使う挿入系のボタンを、スクロールの奥へ押しやらない */}
        <button
          type="button"
          onClick={onToggleLivePreview}
          aria-pressed={livePreview}
          className={TOOL_SLOT}
        >
          <ToolIcon color={livePreview ? "text-blue-600" : "text-gray-500"}>
            <LivePreviewIcon />
          </ToolIcon>
          {livePreview ? "記法を表示" : "装飾表示"}
        </button>
      </div>
    </>
  );
}
