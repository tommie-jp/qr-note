// 測る区間だけ V8 の CPU プロファイルを取る (docs/121 §3-4)。
//
// `node --cpu-prof` はプロセス全体が対象で、終了時にしか書けず、起動の
// コマンドも変える必要がある。node:inspector なら追加のフラグも依存も要らず、
// standalone のまま、区間だけに絞れる (要求の処理が混ざらない)。
//
// 出した cpuprofile は Chrome DevTools の Performance (Load profile) か
// speedscope で開く
import 'server-only'
import { Session } from 'node:inspector/promises'

// サンプリングの間隔 (µs)。既定 1000µs では 1 件数 ms の解析が数点にしか
// ならないので細かくする
const SAMPLING_INTERVAL_US = 100

export async function profileCpu<T>(fn: () => Promise<T>): Promise<{ result: T; profile: unknown }> {
  const session = new Session()
  session.connect()
  try {
    await session.post('Profiler.enable')
    await session.post('Profiler.setSamplingInterval', { interval: SAMPLING_INTERVAL_US })
    await session.post('Profiler.start')
    const result = await fn()
    const { profile } = await session.post('Profiler.stop')
    return { result, profile }
  } finally {
    session.disconnect()
  }
}
