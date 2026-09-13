// 掴んだカメラ・マイクを離す (docs/93-リファクタリング計画.md §3-2)。
//
// ストリームへの参照を捨てるだけではデバイスは掴まれたままで、タブの
// カメラ・マイク使用中表示が残り続ける。track を 1 本ずつ stop() する。
// 映像だけでなく音声のトラック (録画のマイク・録音) も同じく止めるので、
// マイクだけのストリーム (lib/audio/audioRecorder.ts) にも使う。
//
// null / undefined は「まだ開いていない」として何もしない

// stop() できる track を返せるもの。MediaStream も、テストの偽物も渡せる
export interface StoppableStream {
  getTracks(): ReadonlyArray<{ stop(): void }>
}

export function stopStream(stream: StoppableStream | null | undefined): void {
  stream?.getTracks().forEach((track) => track.stop())
}
