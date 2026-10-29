// ベンチマークの画面に渡す状態 (docs/121 §1)。ページ (初回の描画) と
// Server Action (計測中のポーリング) が同じものを読む。
//
// 保存ファイルは 1 つずつ読み、壊れていたら理由を errors に足して他は出す
// (1 つ壊れただけで画面全体を落とさない。未計測と取り違えもしない)
import 'server-only'
import { formatBenchmark, readSavedBenchmark } from './benchmark'
import { jobProgress } from './benchJob'
import { profileSavedAt, readClientBenches, readServerBench } from './benchStore'
import type { BenchJobKind, ClientBenchRun, ServerBenchResult } from './benchTypes'
import { safeErrorText } from './safeErrorText'

export type BenchStatus = {
  running: BenchJobKind | null
  // 7z b の結果 (整形済み)。未計測は null
  cpu: string | null
  server: ServerBenchResult | null
  // 端末 × 回線ごとの最新 1 回 (端末名・回線の順に並べる)
  clients: ClientBenchRun[]
  // cpuprofile の保存日時 (ISO)。無ければ null
  profileAt: string | null
  // 計測の失敗と読み出しの失敗 (画面にそのまま出す)
  errors: string[]
}

async function settle<T>(label: string, read: () => Promise<T>, fallback: T): Promise<{ value: T; error: string | null }> {
  try {
    return { value: await read(), error: null }
  } catch (error) {
    return { value: fallback, error: `${label}: ${safeErrorText(error)}` }
  }
}

export async function loadBenchStatus(): Promise<BenchStatus> {
  const { running, errors: jobErrors } = jobProgress()
  const [cpu, server, clients, profileAt] = await Promise.all([
    settle('7z b の保存', async () => {
      const saved = await readSavedBenchmark()
      return saved && formatBenchmark(saved)
    }, null),
    settle('サーバ側ベンチの保存', () => readServerBench(), null),
    settle('端末の計測の保存', () => readClientBenches(), {}),
    settle('プロファイル', () => profileSavedAt(), null),
  ])
  const runs = Object.values(clients.value).sort(
    (a, b) => a.device.localeCompare(b.device) || a.line.localeCompare(b.line),
  )
  const jobMessages = [
    jobErrors.cpu && `7z b: ${jobErrors.cpu}`,
    jobErrors.server && `サーバ側ベンチ: ${jobErrors.server}`,
  ]
  return {
    running,
    cpu: cpu.value,
    server: server.value,
    clients: runs,
    profileAt: profileAt.value,
    errors: [...jobMessages, cpu.error, server.error, clients.error, profileAt.error].filter(
      (message): message is string => typeof message === 'string' && message !== '',
    ),
  }
}
