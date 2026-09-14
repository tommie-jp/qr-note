"use client";

import {
  useAudioRecording,
  type AudioRecordingState,
} from "@/components/audio/useAudioRecording";
import {
  useVideoRecording,
  type VideoRecordingState,
} from "@/components/video/useVideoRecording";
import { recordingAltText } from "@/lib/audio/audioRecorder";
import { recordingAltText as videoRecordingAltText } from "@/lib/video/videoRecorder";
import type { InsertFiles } from "./useAttachmentInsert";
import type { EditorRef, SetEditorError } from "./types";

export interface EditorRecordings {
  recording: AudioRecordingState;
  videoRecording: VideoRecordingState;
  // 録音か録画のどちらかが回っている (送信を止める)
  isRecording: boolean;
}

// 編集画面からのその場録音・録画。録れたものは、ファイル選択と同じ挿入経路
// (insertFiles) に流す。alt には日時を残す (PDF のファイル名と同じ狙いで、
// 全文検索から引ける)
export function useEditorRecordings({
  editorRef,
  setError,
  insertFiles,
}: {
  editorRef: EditorRef;
  setError: SetEditorError;
  insertFiles: InsertFiles;
}): EditorRecordings {
  // 録音 (41-QR-search/docs/12「ノート内録音の実装計画」)
  const recording = useAudioRecording({
    onFinish: async (result) => {
      const view = editorRef.current?.view;
      if (!view) {
        return;
      }
      await insertFiles(view, [result.file], {
        audioAlt: recordingAltText(result.recordedAt),
      });
    },
    onError: setError,
  });

  // 録画 (41-QR-search/docs/14-動画挿入計画.md)
  const videoRecording = useVideoRecording({
    onFinish: async (result) => {
      const view = editorRef.current?.view;
      if (!view) {
        return;
      }
      await insertFiles(view, [result.file], {
        videoAlt: videoRecordingAltText(result.recordedAt),
      });
    },
    onError: setError,
  });

  return {
    recording,
    videoRecording,
    isRecording: recording.isRecording || videoRecording.isRecording,
  };
}
