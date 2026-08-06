// 取り込みの進み具合の**形と読み方** (docs/28-エクスポート計画.md §9)。
//
// サーバ側の控え (importProgressStore.ts) と表示側 (NotesImporter) の両方が
// 使うので、状態を持たないここに置く (logEntry.ts と logBuffer.ts の関係と
// 同じ)。状態を持つ側に置くと、控えの仕組みごとクライアントのバンドルに載る。

// 取り込みは 2 段構え (§3 実装結果)。バイトを読みながら添付を保存し、
// 全部読み終えてからノートを反映する
export type ImportPhase =
  // 本文を読みながら添付を保存している
  | 'receiving'
  // 読み終わってノートを反映している
  | 'notes'
  | 'done'

export interface ImportProgress {
  phase: ImportPhase
  // Content-Length の名乗り。付かない相手 (chunked) では null になり、
  // そのときは % を出さない
  totalBytes: number | null
  readBytes: number
  notesTotal: number
  notesDone: number
}

// 受信 (添付の保存を含む) に割り当てる割合。残りがノートの反映。
//
// 175MB の実測ではバイト受信 + 添付保存が支配的で、ノート反映は数秒だった。
// ただし**配分が実態とずれても進捗が後戻りしない**ことのほうが大事なので、
// 段の境界で必ずこの値を跨ぐ単調な定義にしてある
const RECEIVING_SHARE = 90

// 表示用の百分率 (0〜100、整数)。総バイト数が判らなければ null。
export function importPercent(progress: ImportProgress): number | null {
  if (progress.phase === 'done') {
    return 100
  }

  if (progress.phase === 'receiving') {
    if (progress.totalBytes === null || progress.totalBytes <= 0) {
      return null
    }
    // 名乗りより多く届くことがある (Content-Length は当てにならない)。
    // 段の上限を超えさせない
    const ratio = Math.min(progress.readBytes / progress.totalBytes, 1)
    return Math.round(ratio * RECEIVING_SHARE)
  }

  // ノートが 0 件の ZIP (添付だけ) で 90% のまま止まって見えないよう、
  // 分母が 0 のときは段を渡り切ったものとして扱う
  const ratio = progress.notesTotal <= 0 ? 1 : progress.notesDone / progress.notesTotal
  return Math.round(RECEIVING_SHARE + ratio * (100 - RECEIVING_SHARE))
}

// 見積もりを始めるまでの助走。開始直後は 1 サンプルの速度が実態から
// 大きく外れる — 初速で計算した「残り 4000 秒」が一瞬見えるのは、
// 数字が無いより悪い
const WARMUP_MS = 2000
const WARMUP_PERCENT = 2

// 残り秒。判らない・早すぎるときは null。
//
// **経過時間と % だけで出す**。速度の移動平均は持たない — 表示は 500ms ごとに
// 更新されるので、経過に対する平均速度がそのまま滑らかな見積もりになる
// (瞬間速度で出すと、添付 1 件の保存のたびに数字が跳ねる)。
export function remainingSeconds(
  percent: number | null,
  elapsedMs: number,
): number | null {
  if (percent === null || percent >= 100) {
    return percent === null ? null : 0
  }
  if (elapsedMs < WARMUP_MS || percent < WARMUP_PERCENT) {
    return null
  }
  const msPerPercent = elapsedMs / percent
  return Math.round(((100 - percent) * msPerPercent) / 1000)
}

// 90 秒までは秒、それを超えたら分に畳む。秒単位で「残り 600 秒」と言われても
// 人は長さを掴めない
const SECONDS_LIMIT = 90

export function formatRemaining(seconds: number): string {
  if (seconds <= 0) {
    return 'まもなく完了'
  }
  if (seconds <= SECONDS_LIMIT) {
    return `残り約 ${seconds} 秒`
  }
  return `残り約 ${Math.ceil(seconds / 60)} 分`
}

// 進捗を覗きに行く間隔。短くすると滑らかになるが、そのぶん取り込み中の
// サーバに要求が増える。500ms は「バーが滑らかに見える」下限あたり
export const PROGRESS_POLL_MS = 500
