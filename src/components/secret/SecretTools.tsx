"use client";

import { useRef, useState, type RefObject } from "react";
import { BusyNotice } from "@/components/chrome/BusyNotice";
import { VideoRecordModal } from "@/components/video/VideoRecordModal";
import { ocrButtonLabel, recordButtonLabel } from "@/lib/progress/progressLabels";
import { SecretDrawModal, SecretScanModal } from "./SecretToolModals";
import { SecretToolbar } from "./SecretToolbar";
import { type SecretSelection, useSecretToolActions } from "./useSecretTools";

export type { SecretSelection } from "./useSecretTools";

export interface SecretToolsProps {
  disabled: boolean;
  // 現在の入力欄の中身と選択範囲。OCR はカーソル位置の画像を読むので、
  // 挿入だけでなく「いまどこを見ているか」も要る
  getSelection: () => SecretSelection;
  // 1 ブロックとして差し込む (前後に改行を足す)
  insertBlock: (markdown: string) => void;
  onBusyChange: (busy: boolean) => void;
  onError: (message: string | null) => void;
}

// 画像を選ぶ隠し input。釦 (ツール行の「画像」) から click() で開く
function SecretImagePicker({
  inputRef,
  onPick,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  onPick: (file: File) => void;
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      hidden
      onChange={(e) => {
        const file = e.target.files?.[0];
        // 同じファイルを続けて選べるように毎回空にする
        e.target.value = "";
        if (file) {
          onPick(file);
        }
      }}
    />
  );
}

// OCR・録音・録画の知らせ。どれも無ければ出さない
function SecretToolNotice({ note, busy }: { note: string | null; busy: boolean }) {
  if (note === null) {
    return null;
  }
  return (
    <BusyNotice aria-live="polite" busy={busy}>
      {note}
    </BusyNotice>
  );
}

// シークレット入力ダイアログの道具立て (docs/53-シークレット挿入拡張計画.md)。
//
// 編集画面で挿せるもの (画像・録音・録画・お絵かき・OCR・スキャン) を、
// **すべてクライアントで暗号化してから**断片として保存する。通常の
// アップロード (/api/images) は一切通らないので、サムネも埋め込みも
// 認識結果もサーバには残らない。
//
// SecretDialog から切り出してあるのは、あちらを本文とラベルの入力に
// 集中させるため (道具が 6 つあり、モーダルも 3 つぶら下がる)。
export function SecretTools({ disabled, ...handlers }: SecretToolsProps) {
  const [drawing, setDrawing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { run, insertMedia, recording, videoRecording, ocrCount, note, runOcr } =
    useSecretToolActions(handlers);
  // 画像 (ファイル選択・お絵かき) は canvas で描き直してから包む
  const insertImage = (file: File, alt: string) =>
    void run(() => insertMedia(file, alt, true));

  return (
    <>
      <SecretToolbar
        disabled={disabled}
        onInsertImage={() => fileRef.current?.click()}
        onDraw={() => setDrawing(true)}
        recordLabel={recordButtonLabel(recording.isRecording, recording.elapsedMs)}
        isRecording={recording.isRecording}
        onToggleRecord={recording.toggle}
        onRecordVideo={videoRecording.openPreview}
        ocrLabel={ocrButtonLabel(ocrCount)}
        onOcr={runOcr}
        onScan={() => setScanning(true)}
      />

      <SecretImagePicker inputRef={fileRef} onPick={(file) => insertImage(file, "画像")} />

      <SecretToolNotice
        note={note ?? recording.note ?? videoRecording.note}
        busy={ocrCount > 0}
      />

      {/* 録画は全画面モーダル。プレビュー・録画・カメラ操作は編集画面と同じ部品 */}
      <VideoRecordModal video={videoRecording} />

      <SecretDrawModal
        open={drawing}
        onCancel={() => setDrawing(false)}
        onInsert={(file, alt) => {
          setDrawing(false);
          insertImage(file, alt);
        }}
      />

      <SecretScanModal
        open={scanning}
        onClose={() => setScanning(false)}
        onCode={handlers.insertBlock}
      />
    </>
  );
}
