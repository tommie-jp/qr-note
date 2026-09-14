"use client";

import dynamic from "next/dynamic";
import type { VideoRecordingState } from "@/components/useVideoRecording";
import { VideoRecordModal } from "@/components/VideoRecordModal";
import type { EditorDrawing } from "./hooks/useEditorDrawing";
import type { EditorScanInsert } from "./hooks/useEditorScanInsert";
import type { EditorSecret } from "./hooks/useEditorSecret";

// fabric 一式は重いので、お絵かきを開くまで読み込まない
// (CodeMirror を遅延させているのと同じ流儀。MemoEditor.tsx 参照)
const DrawModal = dynamic(() => import("@/components/draw/DrawModal"), {
  ssr: false,
  loading: () => null,
});

// スキャナ (カメラ + zxing wasm) も重いので、スキャンを押すまで読み込まない。
// 検索画面 (BottomActionBar) と同じ部品を、挿入モード (onResult) で使う
const ScannerModal = dynamic(
  () => import("@/components/ScannerModal").then((m) => m.ScannerModal),
  { ssr: false, loading: () => null },
);

// シークレットの入力ダイアログ (docs/51-部分暗号化計画.md §8)。
// 開くまで読み込まない (暗号まわり一式を普段の編集に載せない)
const SecretDialog = dynamic(
  () => import("@/components/secret/SecretDialog").then((m) => m.SecretDialog),
  { ssr: false, loading: () => null },
);

interface EditorModalsProps {
  videoRecording: VideoRecordingState;
  drawings: Pick<EditorDrawing, "drawing" | "closeDrawing" | "insertDrawing">;
  secrets: Pick<EditorSecret, "secret" | "applySecret" | "closeSecret">;
  scan: Pick<EditorScanInsert, "scanning" | "closeScanner" | "runScanInsert">;
}

// 編集画面から開く全画面の部品 (docs/93-リファクタリング計画.md §5-1)。
// どれも body へ portal するので、ここに置いても編集エリアの DOM には何も足さない
export function EditorModals({
  videoRecording,
  drawings,
  secrets,
  scan,
}: EditorModalsProps) {
  return (
    <>
      {/* 録画は全画面モーダルで行う (プレビュー・録画・カメラ操作すべて)。
          state と操作は videoRecording が持ち、ここは開閉のきっかけだけ */}
      <VideoRecordModal video={videoRecording} />
      {drawings.drawing && (
        <DrawModal
          sourceImageUrl={drawings.drawing.sourceImageUrl}
          onCancel={drawings.closeDrawing}
          onInsert={drawings.insertDrawing}
        />
      )}
      {/* シークレットの入力。**本文の state を経由しない** — ここで書いた
          平文は封をしてからでないと外へ出ない (docs/51 §8) */}
      {secrets.secret && (
        <SecretDialog
          name={secrets.secret.name}
          initialText={secrets.secret.text}
          initialLabel={secrets.secret.label}
          onSaved={secrets.applySecret}
          onClose={secrets.closeSecret}
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
    </>
  );
}
