// MediaRecorder を止めて、溜めた断片を 1 つの Blob にまとめる
// (録音 lib/audio/audioRecorder.ts・録画 lib/video/videoRecorder.ts が共有する)。
//
// 断片と開始時刻は onstop の時点で読む — 最後の断片 (dataavailable) は
// stop() の後、onstop より前に届くので、呼んだ時点の配列では足りない。

export interface StoppedRecording {
  blob: Blob
  mimeType: string
  durationMs: number
}

export function stopRecorder(
  recorder: MediaRecorder,
  chunks: () => Blob[],
  startedAt: () => number,
): Promise<StoppedRecording> {
  return new Promise<StoppedRecording>((resolve) => {
    recorder.onstop = () => {
      const type = recorder.mimeType
      resolve({
        blob: new Blob(chunks(), { type }),
        mimeType: type,
        durationMs: Date.now() - startedAt(),
      })
    }
    recorder.stop()
  })
}
