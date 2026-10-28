// 速度計測を今しているか (docs/119-速度計測ログ計画.md §1-4)。
//
// **切替は実行時に /logs?perf=1 から押す**。環境変数で切り替える形にすると、
// 本番では compose.yaml と .env を直して作り直す手間が測るたびに掛かる。
// 計測は「測る期間だけ立てる」ものなので、押して立て、終わったら押して戻す。
// 既定は PERF_LOG (appEnv.ts)。再起動・配布で既定に戻る。
//
// 値は globalThis に持つ (logging/buffer.ts と同じ理由。dev のホットリロードで
// モジュールが評価し直されても切替が戻らない)。コンテナは 1 つなので、
// プロセスの中に持てば全端末に効く
import 'server-only'
import { perfLogEnv } from '@/lib/appEnv'

const globalForPerf = globalThis as unknown as { qrNotePerf?: { enabled: boolean } }

export function isPerfLogEnabled(): boolean {
  globalForPerf.qrNotePerf ??= { enabled: perfLogEnv() === '1' }
  return globalForPerf.qrNotePerf.enabled
}

export function setPerfLogEnabled(enabled: boolean): void {
  globalForPerf.qrNotePerf = { enabled }
}
