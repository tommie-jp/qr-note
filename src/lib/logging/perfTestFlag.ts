// 計測テストの「読み込み直したら流す」印 (docs/120 §2)。
//
// メニューで開始を押すと、計測を立ててから読み込み直す (ブラウザ側の観測は
// root layout が描くかどうかで決まるため。docs/119 §1-4)。読み込み直した先で
// 流すことを覚えておく場所がこの印で、sessionStorage に置く (このタブだけ。
// 別のタブや端末で勝手に流れ始めない)。
//
// 保存を塞いだブラウザでは例外になるので、読み書きはすべてここを通す
// (offline/schedule.ts の readMark と同じ作法)
const PERF_TEST_FLAG_KEY = 'qr:perfTest'

// 印に添える流し方 (docs/121 §4-2)。メニューの「計測開始」は中身なしで付ける
export interface PerfTestOptions {
  // 回線の種別 (有線 / Wi-Fi / キャリア)。あれば 1 段目に回線を測る
  line?: string
  // 終わった後に戻る先。ベンチマークの画面だけを許す (PERF_TEST_RETURN_PATHS)
  returnTo?: string
}

// 戻り先は印の値から URL を組むので、固定の行き先に絞る
export const PERF_TEST_RETURN_PATHS = ['/settings/benchmark'] as const

export function markPerfTestPending(options: PerfTestOptions = {}): void {
  try {
    sessionStorage.setItem(PERF_TEST_FLAG_KEY, JSON.stringify(options))
  } catch {
    // 保存できなければ流れないだけ (メニューから押し直せる)
  }
}

// 印の中身を検算する。旧形式の '1' や読めない値は「中身なし」
export function parsePerfTestOptions(raw: string): PerfTestOptions {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return {}
  }
  if (typeof value !== 'object' || value === null) {
    return {}
  }
  const { line, returnTo } = value as Record<string, unknown>
  return {
    ...(typeof line === 'string' && line !== '' ? { line } : {}),
    ...(PERF_TEST_RETURN_PATHS.some((path) => path === returnTo) ? { returnTo: returnTo as string } : {}),
  }
}

// 印があれば消して中身を返す (無ければ null)。読み込み直しのたびに流れ直さないよう、読んだら消す
export function takePerfTestPending(): PerfTestOptions | null {
  try {
    const raw = sessionStorage.getItem(PERF_TEST_FLAG_KEY)
    sessionStorage.removeItem(PERF_TEST_FLAG_KEY)
    return raw === null ? null : parsePerfTestOptions(raw)
  } catch {
    return null
  }
}

export function clearPerfTestPending(): void {
  try {
    sessionStorage.removeItem(PERF_TEST_FLAG_KEY)
  } catch {
    // 消せなくても害はない (次に読んだときに消える)
  }
}

// 流している最中の印 (docs/120 §2)。手順の途中で全体の読み込み直しが起きると
// (押したリンクが素の遷移だった・利用者が触った)、流していた手順は消えて
// 計測を止める段まで届かない。始めるときに付け、終わったら消す。読み込み直した
// 先で印が残っていれば「途中で切れた」と分かるので、記録して計測を止める
const PERF_TEST_RUNNING_KEY = 'qr:perfTestRunning'

export function markPerfTestRunning(): void {
  try {
    sessionStorage.setItem(PERF_TEST_RUNNING_KEY, '1')
  } catch {
    // 保存できなければ途切れたことに気づけないだけ
  }
}

export function clearPerfTestRunning(): void {
  try {
    sessionStorage.removeItem(PERF_TEST_RUNNING_KEY)
  } catch {
    // 消せなくても次に読んだときに消える
  }
}

// 流している最中の印が残っていれば消して true (途中で切れた)
export function takePerfTestInterrupted(): boolean {
  try {
    const interrupted = sessionStorage.getItem(PERF_TEST_RUNNING_KEY) === '1'
    sessionStorage.removeItem(PERF_TEST_RUNNING_KEY)
    return interrupted
  } catch {
    return false
  }
}
