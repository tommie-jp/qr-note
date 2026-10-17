// 待ち時間に上限を付ける (docs/109-サーバー情報計画.md §2)。
//
// サーバー情報の各節は DB やファイルを待つ。DB が固まっていると画面が
// 永遠に出ない — そういうときこそ見たい画面なので、節ごとに切り上げて
// 「取得できませんでした」に倒す。
//
// 元の処理は止めない (Promise は取り消せない)。切り上げた後に元が終わっても
// 結果は捨てられるだけで、副作用のある処理には使わないこと

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} が ${ms}ms 以内に応答しない`)
    this.name = 'TimeoutError'
  }
}

export function withTimeout<T>(task: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms)
    task.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
