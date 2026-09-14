import { BusyNotice } from "@/components/chrome/BusyNotice";
import type { EditorOcr } from "./hooks/useEditorOcr";
import type { EditorScanInsert } from "./hooks/useEditorScanInsert";

interface EditorBannersProps {
  error: string | null;
  // 録音・録画の自動停止の知らせ
  recordingNote: string | null;
  videoRecordingNote: string | null;
  ocr: Pick<EditorOcr, "ocrNote" | "ocrCount" | "modelPercent">;
  scan: Pick<EditorScanInsert, "scanNote" | "scanBusy">;
}

// エディタ直下のエラーと知らせ (docs/93-リファクタリング計画.md §5-1)。
// 打鍵中に見える本文の近くに置く (ツールバーは下部バーへ portal してある)。
// 並び順はそのまま DOM の順 — 囲みの space-y の間隔もこの順で付く
export function EditorBanners({
  error,
  recordingNote,
  videoRecordingNote,
  ocr,
  scan,
}: EditorBannersProps) {
  return (
    <>
      {error && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {/* 自動停止の知らせ。押していないのに止まった理由が判らないと、
          録音が切れた原因を探せない */}
      {recordingNote && (
        <BusyNotice aria-live="polite">{recordingNote}</BusyNotice>
      )}
      {videoRecordingNote && (
        <BusyNotice aria-live="polite">{videoRecordingNote}</BusyNotice>
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
    </>
  );
}
