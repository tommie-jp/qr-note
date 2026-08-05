"use client";

import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";
import { BUSY_NOTICE_CLASS, BUSY_SPINNER_CLASS } from "@/components/ui";
import { VideoRecordModal } from "@/components/VideoRecordModal";
import { useAudioRecording } from "@/components/useAudioRecording";
import { useVideoRecording } from "@/components/useVideoRecording";
import { recordingAltText } from "@/lib/audio/audioRecorder";
import { recordingAltText as videoRecordingAltText } from "@/lib/video/videoRecorder";
import { ocrButtonLabel, recordButtonLabel } from "@/lib/progressLabels";
import { loadSecret, newSecretName, saveSecretMedia } from "@/lib/secretContent";
import { prepareSecretImage } from "@/lib/secretImage";
import { secretMimeKind } from "@/lib/secretPayload";
import { SecretCancelledError } from "@/lib/secretPrf";
import { isUnlocked } from "@/lib/secretSession";
import { unlockWithPasskey } from "@/lib/secretUnlock";
import { secretAtCursor, secretUrl } from "@/lib/secrets";
import { SecretToolbar } from "./SecretToolbar";

// 重い部品は開くまで読まない (編集画面と同じ流儀)
const DrawModal = dynamic(() => import("@/components/draw/DrawModal"), {
  ssr: false,
  loading: () => null,
});

const ScannerModal = dynamic(
  () => import("@/components/ScannerModal").then((m) => m.ScannerModal),
  { ssr: false, loading: () => null },
);

// OCR 一式 (Worker + モデル) も押すまで読まない
const ocrService = () => import("@/components/ocr/ocrService");

export interface SecretSelection {
  text: string;
  from: number;
  to: number;
}

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

// シークレット入力ダイアログの道具立て (docs/53-シークレット挿入拡張計画.md)。
//
// 編集画面で挿せるもの (画像・録音・録画・お絵かき・OCR・スキャン) を、
// **すべてクライアントで暗号化してから**断片として保存する。通常の
// アップロード (/api/images) は一切通らないので、サムネも埋め込みも
// 認識結果もサーバには残らない。
//
// SecretDialog から切り出してあるのは、あちらを本文とラベルの入力に
// 集中させるため (道具が 6 つあり、モーダルも 3 つぶら下がる)。
export function SecretTools({
  disabled,
  getSelection,
  insertBlock,
  onBusyChange,
  onError,
}: SecretToolsProps) {
  const [drawing, setDrawing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [ocrCount, setOcrCount] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 道具の処理をまとめて包む。解錠 → 実行 → 後始末をここに一度だけ書く。
  // 取り消し (Face ID を閉じた) は失敗として出さない
  const run = useCallback(
    async (action: () => Promise<void>) => {
      onBusyChange(true);
      onError(null);
      try {
        if (!isUnlocked()) {
          await unlockWithPasskey();
        }
        await action();
      } catch (cause) {
        if (cause instanceof SecretCancelledError) {
          return;
        }
        console.error("シークレットへの挿入に失敗しました", cause);
        onError(
          cause instanceof Error && cause.message !== ""
            ? cause.message
            : "挿入に失敗しました",
        );
      } finally {
        onBusyChange(false);
      }
    },
    [onBusyChange, onError],
  );

  // 媒体 (画像・音声・動画) を別の断片として暗号化し、参照だけを本文へ書く。
  // 画像だけは canvas で描き直してから包む (形式を揃え、EXIF も落ちる)
  const insertMedia = useCallback(
    async (file: File, alt: string, convertImage: boolean) => {
      const name = newSecretName();
      if (convertImage) {
        const image = await prepareSecretImage(file);
        await saveSecretMedia(name, image.mime, image.bytes);
      } else {
        await saveSecretMedia(
          name,
          file.type,
          new Uint8Array(await file.arrayBuffer()),
        );
      }
      insertBlock(`![${alt}](${secretUrl(name)})`);
    },
    [insertBlock],
  );

  const recording = useAudioRecording({
    onFinish: (result) =>
      run(() =>
        insertMedia(result.file, recordingAltText(result.recordedAt), false),
      ),
    onError,
  });

  const videoRecording = useVideoRecording({
    onFinish: (result) =>
      run(() =>
        insertMedia(
          result.file,
          videoRecordingAltText(result.recordedAt),
          false,
        ),
      ),
    onError,
  });

  // カーソル位置の画像を読む (docs/24-画像OCR計画.md の断片版)。
  //
  // **復号した画素をそのまま Worker へ渡す**ので、認識のためにサーバへ
  // 画像を送ることはない。読んだ結果は引用ブロックとして本文へ入る
  const runOcr = useCallback(() => {
    const selection = getSelection();
    const hit = secretAtCursor(selection.text, selection.from);
    if (hit === null) {
      setNote(
        "読みたい画像の上にカーソルを置いてから押してください (この断片に貼った画像が対象です)。",
      );
      return;
    }

    setOcrCount((count) => count + 1);
    void run(async () => {
      try {
        const content = await loadSecret(hit.name);
        if (secretMimeKind(content.mime) !== "image") {
          setNote("カーソル位置は画像ではありません。");
          return;
        }
        const { ocrImageToQuote } = await ocrService();
        const quote = await ocrImageToQuote(
          new Blob([content.bytes as unknown as BlobPart], {
            type: content.mime,
          }),
        );
        if (quote === "") {
          setNote("文字を読み取れませんでした。");
          return;
        }
        setNote(null);
        insertBlock(quote);
      } finally {
        setOcrCount((count) => count - 1);
      }
    });
  }, [getSelection, insertBlock, run]);

  return (
    <>
      <SecretToolbar
        disabled={disabled}
        onInsertImage={() => fileRef.current?.click()}
        onDraw={() => setDrawing(true)}
        recordLabel={recordButtonLabel(
          recording.isRecording,
          recording.elapsedMs,
        )}
        isRecording={recording.isRecording}
        onToggleRecord={recording.toggle}
        onRecordVideo={videoRecording.openPreview}
        ocrLabel={ocrButtonLabel(ocrCount)}
        onOcr={runOcr}
        onScan={() => setScanning(true)}
      />

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          // 同じファイルを続けて選べるように毎回空にする
          e.target.value = "";
          if (file) {
            void run(() => insertMedia(file, "画像", true));
          }
        }}
      />

      {(note !== null || recording.note !== null || videoRecording.note !== null) && (
        <p aria-live="polite" className={`${BUSY_NOTICE_CLASS} flex items-center gap-2`}>
          {ocrCount > 0 && <span aria-hidden className={BUSY_SPINNER_CLASS} />}
          {note ?? recording.note ?? videoRecording.note}
        </p>
      )}

      {/* 録画は全画面モーダル。プレビュー・録画・カメラ操作は編集画面と同じ部品 */}
      <VideoRecordModal video={videoRecording} />

      {drawing && (
        <DrawModal
          // 下敷きにできる画像は渡さない。断片内の画像は Blob URL でしか
          // 出せず、下敷きの取り込み経路 (URL 取得) とは噛み合わないため
          sourceImageUrl={null}
          onCancel={() => setDrawing(false)}
          onInsert={(file, alt) => {
            setDrawing(false);
            void run(() => insertMedia(file, alt, true));
          }}
        />
      )}

      {/* スキャンは**読み取った文字を入れるだけ**。書誌・商品情報の取得は
          しない — コードを自サーバと外部 API へ送ることになり、「何を
          スキャンしたか」が管理者に見えてしまう (docs/53 §1) */}
      {scanning && (
        <ScannerModal
          title="コードをかざす (情報の取得はしません)"
          onClose={() => setScanning(false)}
          onResult={(rawValue) => {
            setScanning(false);
            const code = rawValue.trim();
            if (code !== "") {
              insertBlock(code);
            }
          }}
        />
      )}
    </>
  );
}
