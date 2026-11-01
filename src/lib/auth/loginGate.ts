// ログインの照合 (bcrypt) を同時に何本まで回すかの門 (2026-11 のセキュリティ監査)。
//
// bcryptjs は純 JS で、Node のメインスレッドで回る。コスト 12 は本番で約 1.75 秒/回。
// nginx の limit_req (30r/m、IP 単位。deploy/nginx/qr.tommie.jp.conf) はあるが、
// 複数の IP から撃たれると、同時実行に上限が無いぶん待ち行列が伸びて
// アプリ全体が固まる (CPU 枯渇)。
//
// 使うのは 1 人で、同時のログインは滅多に起きない。同時 1 本 + 待ち数本に絞り、
// 超えた分は**待たせずに 429 で断る** — 黙って数十秒待たせるより、
// 「混み合っている」と正直に返すほうが本人にも分かりやすい。
//
// この階層は bcrypt も next/server も知らない純粋な semaphore。
// 口は auth/basicAuth.ts の照合 1 か所で、429 に写すのは app/login/route.ts。

// 同時に回す照合の本数。bcrypt は 100ms ごとに setImmediate で譲るだけなので、
// 2 本にすると他の要求が 200ms 待たされる区間ができる。1 本でよい
export const MAX_CONCURRENT_VERIFICATIONS = 1

// 枠が空くのを待てる本数。これを超えた分は即座に断る。
// 「家族の端末で同時にログイン」程度は待てる大きさ、総当たりの並列は入らない大きさ
export const MAX_WAITING_VERIFICATIONS = 3

// 断ったときに Retry-After で伝える秒数。bcrypt 1 本 + 待ち 3 本が捌ける目安
export const LOGIN_RETRY_AFTER_SECONDS = 8

// 門が満杯で断ったときの印。route はこれを 429 に写す。
// 照合の失敗 (null) とは別物なので、例外で区別する
export class LoginBusyError extends Error {
  constructor() {
    super('ログインが混み合っています')
    this.name = 'LoginBusyError'
  }
}

export interface LoginGateOptions {
  readonly maxConcurrent: number
  readonly maxWaiting: number
}

export interface LoginGate {
  // task を枠が取れたら実行する。枠も待ち席も無ければ LoginBusyError で即座に reject
  run<T>(task: () => Promise<T>): Promise<T>
  // 観測用 (テストと /settings/server)。
  readonly running: number
  readonly waiting: number
}

// 門を作る。テストは小さな値で独立した門を作り、本体は下の loginGate を共有する
export function createLoginGate({ maxConcurrent, maxWaiting }: LoginGateOptions): LoginGate {
  let running = 0
  const waiters: Array<() => void> = []

  // 枠を取る。取れたら resolve 済み、待つなら待ち席の順番で resolve、
  // 満杯なら**同期的に**投げる (呼び出し側が await する前に決まる)
  function acquire(): Promise<void> {
    if (running < maxConcurrent) {
      running += 1
      return Promise.resolve()
    }
    if (waiters.length >= maxWaiting) {
      throw new LoginBusyError()
    }
    return new Promise<void>((resolve) => {
      waiters.push(resolve)
    })
  }

  // 枠を返す。待っている人が居れば**枠をそのまま手渡す** (running は変えない)
  function release(): void {
    const next = waiters.shift()
    if (next !== undefined) {
      next()
      return
    }
    running -= 1
  }

  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      // acquire が同期で投げたら、この async 関数の reject として呼び出し側へ届く
      await acquire()
      try {
        return await task()
      } finally {
        release()
      }
    },
    get running() {
      return running
    },
    get waiting() {
      return waiters.length
    },
  }
}

// アプリ本体が共有する門 (プロセスに 1 つ。単一コンテナ・単一プロセス前提)
export const loginGate = createLoginGate({
  maxConcurrent: MAX_CONCURRENT_VERIFICATIONS,
  maxWaiting: MAX_WAITING_VERIFICATIONS,
})
