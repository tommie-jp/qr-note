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

export function markPerfTestPending(): void {
  try {
    sessionStorage.setItem(PERF_TEST_FLAG_KEY, '1')
  } catch {
    // 保存できなければ流れないだけ (メニューから押し直せる)
  }
}

// 印があれば消して true。読み込み直しのたびに流れ直さないよう、読んだら消す
export function takePerfTestPending(): boolean {
  try {
    const pending = sessionStorage.getItem(PERF_TEST_FLAG_KEY) === '1'
    sessionStorage.removeItem(PERF_TEST_FLAG_KEY)
    return pending
  } catch {
    return false
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
