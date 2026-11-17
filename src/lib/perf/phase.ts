// サーバの段階の計時 (docs/119-速度計測ログ計画.md §2)。
//
//   const t = startPhases(isPerfLogEnabled())
//   const result = await t.time('検索', () => searchItems(...))
//   const perf = t.done()            // 計測していなければ null
//
// 計測していないときは fn を呼ぶだけで何も控えない。呼ぶ側に if を配らない
// ための形で、切っているときの手間は Promise 1 段だけ。
//
// **段階の並びは「始めた順」**。Promise.all で並べた段階は終わる順が毎回
// 変わるので、終わった順に積むと行の列がずれる。始めた時点で枠を取る。
//
// 状態を持たない葉 (server-only でもない)。時計はテストのために差し替えられる

export interface PerfPhases {
  // startPhases から done までの時間
  totalMs: number
  // 段階ごとの時間 (始めた順)。並列の段階はそれぞれの時間で、和は全体を超えうる
  phases: Record<string, number>
}

export interface PhaseTimer {
  time<T>(name: string, fn: () => T | Promise<T>): Promise<T>
  // 同期の段階 (計測していないときに Promise を挟まない)
  timeSync<T>(name: string, fn: () => T): T
  done(): PerfPhases | null
}

const defaultNow = (): number => performance.now()

export function startPhases(enabled: boolean, now: () => number = defaultNow): PhaseTimer {
  if (!enabled) {
    return {
      time: async (_name, fn) => fn(),
      timeSync: (_name, fn) => fn(),
      done: () => null,
    }
  }

  const started = now()
  const phases: Record<string, number> = {}
  return {
    time: async (name, fn) => {
      // 枠を先に取る (並びを始めた順にする)
      phases[name] = 0
      const t0 = now()
      try {
        return await fn()
      } finally {
        phases[name] = now() - t0
      }
    },
    timeSync: (name, fn) => {
      phases[name] = 0
      const t0 = now()
      try {
        return fn()
      } finally {
        phases[name] = now() - t0
      }
    },
    done: () => ({
      totalMs: now() - started,
      // 呼んだ後に time が終わっても、返した値は動かさない (写しを返す)
      phases: Object.fromEntries(
        Object.entries(phases).map(([name, ms]) => [name, Math.round(ms)]),
      ),
    }),
  }
}
