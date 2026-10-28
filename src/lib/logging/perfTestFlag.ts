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
