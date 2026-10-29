// 計測を裏で 1 本だけ走らせる (docs/121 §3-2)。
//
// 7z b とサーバ側ベンチは、どちらも CPU を使い切る。同時に 2 本走らせると
// 互いに遅くなり数字が嘘になるので、片方が走っている間は他方を始めない。
// 結果は待たない — 1 分前後かかるものをリクエストに乗せると nginx の応答待ち
// (既定 60 秒) に切られる。画面は jobProgress を引いて終わりを知り、結果は
// 保存ファイルから読む。
//
// 状態は globalThis に持つ (logging/buffer.ts と同じ理由。Next は Server Action と
// ページと route handler を別々に束ねるので、モジュールの変数だと別物になる)
import 'server-only'
import { errorText } from '../errorMessage'
import type { BenchJobKind } from './benchTypes'
import { safeErrorText } from './safeErrorText'

const LABEL: Readonly<Record<BenchJobKind, string>> = {
  cpu: 'CPU 計測 (7z b)',
  server: 'サーバ側ベンチ',
}

interface JobState {
  running: BenchJobKind | null
  // 種類ごとの直近の失敗理由 (画面に出す)
  errors: Partial<Record<BenchJobKind, string>>
}

const globalForJob = globalThis as unknown as { qrNoteBenchJob?: JobState }

function state(): JobState {
  globalForJob.qrNoteBenchJob ??= { running: null, errors: {} }
  return globalForJob.qrNoteBenchJob
}

// 始めたら true。何か走っていれば始めずに false
export function startJob(kind: BenchJobKind, task: () => Promise<void>): boolean {
  const s = state()
  if (s.running !== null) {
    return false
  }
  s.running = kind
  s.errors = { ...s.errors, [kind]: undefined }
  void Promise.resolve()
    .then(task)
    .catch((error: unknown) => {
      // 画面には理由を出し、/logs にも残す (黙って終わらせない)
      console.warn(`${LABEL[kind]}に失敗`, error instanceof Error ? error : new Error(errorText(error)))
      s.errors = { ...s.errors, [kind]: safeErrorText(error) }
    })
    .finally(() => {
      s.running = null
    })
  return true
}

export function jobProgress(): { running: BenchJobKind | null; errors: Partial<Record<BenchJobKind, string>> } {
  const s = state()
  return { running: s.running, errors: { ...s.errors } }
}
