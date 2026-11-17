"use client";

import { useCallback, useState } from "react";
import { useAudioRecording } from "@/components/audio/useAudioRecording";
import { useVideoRecording } from "@/components/video/useVideoRecording";
import { recordingAltText } from "@/lib/audio/audioRecorder";
import { recordingAltText as videoRecordingAltText } from "@/lib/video/videoRecorder";
import { loadSecret, newSecretName, saveSecretMedia } from "@/lib/secret/content";
import { prepareSecretImage } from "@/lib/secret/image";
import { secretMimeKind } from "@/lib/secret/payload";
import { SecretCancelledError } from "@/lib/secret/prf";
import { isUnlocked } from "@/lib/secret/session";
import { unlockWithPasskey } from "@/lib/secret/unlock";
import { secretAtCursor, secretUrl } from "@/lib/secret/secrets";

// SecretTools の手順をフックに分けたもの (docs/128 §8-1)。どれも SecretTools の
// 中でだけ呼ぶので、持つ状態の寿命は以前と同じ (ダイアログが閉じれば消える)

// 入力欄の中身と選択範囲 (SecretTools の props の型。あちらから再輸出する)
export interface SecretSelection {
  text: string;
  from: number;
  to: number;
}

// OCR 一式 (Worker + モデル) も押すまで読まない
const ocrService = () => import("@/components/ocr/ocrService");

export type SecretToolRun = (action: () => Promise<void>) => Promise<void>;

// 道具の処理をまとめて包む。解錠 → 実行 → 後始末をここに一度だけ書く。
// 取り消し (Face ID を閉じた) は失敗として出さない
export function useSecretToolRun(
  onBusyChange: (busy: boolean) => void,
  onError: (message: string | null) => void,
): SecretToolRun {
  return useCallback(
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
}

export type SecretMediaInsert = (
  file: File,
  alt: string,
  convertImage: boolean,
) => Promise<void>;

// 媒体 (画像・音声・動画) を別の断片として暗号化し、参照だけを本文へ書く。
// 画像だけは canvas で描き直してから包む (形式を揃え、EXIF も落ちる)
export function useSecretMediaInsert(
  insertBlock: (markdown: string) => void,
): SecretMediaInsert {
  return useCallback(
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
}

// 録音・録画。終わったら媒体の断片として暗号化して挿す
export function useSecretRecordings(
  run: SecretToolRun,
  insertMedia: SecretMediaInsert,
  onError: (message: string | null) => void,
) {
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

  return { recording, videoRecording };
}

// 断片の画像を読み、引用ブロックにして返す。画像でなければ null
async function ocrSecretImage(name: string): Promise<string | null> {
  const content = await loadSecret(name);
  if (secretMimeKind(content.mime) !== "image") {
    return null;
  }
  const { ocrImageToQuote } = await ocrService();
  return ocrImageToQuote(
    new Blob([content.bytes as unknown as BlobPart], {
      type: content.mime,
    }),
  );
}

// カーソル位置の画像を読む (docs/24-画像OCR計画.md の断片版)。
//
// **復号した画素をそのまま Worker へ渡す**ので、認識のためにサーバへ
// 画像を送ることはない。読んだ結果は引用ブロックとして本文へ入る
export function useSecretOcr({
  getSelection,
  insertBlock,
  run,
}: {
  getSelection: () => SecretSelection;
  insertBlock: (markdown: string) => void;
  run: SecretToolRun;
}) {
  const [ocrCount, setOcrCount] = useState(0);
  const [note, setNote] = useState<string | null>(null);

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
        const quote = await ocrSecretImage(hit.name);
        if (quote === null) {
          setNote("カーソル位置は画像ではありません。");
          return;
        }
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

  return { ocrCount, note, runOcr };
}

// SecretTools が使う操作一式。呼ぶ順 (包み → 媒体の挿入 → 録音・録画 → OCR) は
// 分ける前と同じ
export function useSecretToolActions({
  getSelection,
  insertBlock,
  onBusyChange,
  onError,
}: {
  getSelection: () => SecretSelection;
  insertBlock: (markdown: string) => void;
  onBusyChange: (busy: boolean) => void;
  onError: (message: string | null) => void;
}) {
  const run = useSecretToolRun(onBusyChange, onError);
  const insertMedia = useSecretMediaInsert(insertBlock);
  const { recording, videoRecording } = useSecretRecordings(run, insertMedia, onError);
  const { ocrCount, note, runOcr } = useSecretOcr({ getSelection, insertBlock, run });
  return { run, insertMedia, recording, videoRecording, ocrCount, note, runOcr };
}
