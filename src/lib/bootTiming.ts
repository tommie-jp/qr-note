// 起動 (最初の画面読み込み) の内訳を測って /logs へ送る (docs/30-ブラウザログ計画.md §6)。
//
// **なぜ要るか。** iPhone の PWA で「デプロイした直後の起動だけ、画面が白い
// まま数十秒動かない」という症状が出ている。iOS は Mac 無しでインスペクタを
// 繋げないため、白い時間の内訳が判らない。候補は 3 つあり、直す場所がまるで違う:
//
//   1. サーバが冷えている — コンテナを作り直した直後の 1 発目は、ルートの
//      モジュールも Prisma の接続も無い状態から始まる (ヘルスチェックは
//      未ログインの / しか叩かないので温まらない)
//   2. Service Worker が殻を作り直している — 版が変われば
//      qr-shell-<版> は空で、描画を止める CSS まで取り直しになる。しかも
//      sw.js の cacheFirst は cache.put を待ってから応答を返す
//   3. 同期が回線を奪っている — 版が変わると OfflineSync が間隔を無視して
//      全ノート同期 + 暖機を走らせる
//
// **1 と 2 は数値で切り分けられる。** responseStart までが伸びていればサーバ
// (1)、そこは速いのに CSS の resource timing が伸びていれば Worker (2)。
// この 1 点のためだけの計測なので、原因が判ったら消してよい。
//
// 送るのは「版が変わった最初の起動」と「遅かった起動」だけにする。毎回送ると
// 200 件のリングバッファ (logEntry.ts) が起動ログだけで埋まる。

// これを超えたら、版が同じでも報告する。数十秒の症状を捕まえるのが目的なので、
// 「体感で明らかに遅い」線に置く (通常の 4G なら 1〜2 秒で描画が始まる)
export const SLOW_BOOT_MS = 4000

// 遅い資源として挙げる下限と件数。全部並べると 1 行が読めなくなるし、
// 速い物は診断に効かない
const SLOW_RESOURCE_FLOOR_MS = 200
const SLOW_RESOURCE_LIMIT = 3

// 最後に報告した版の記録先 (localStorage)。OfflineSync の
// LAST_WARM_VERSION_KEY とは別に持つ — あちらは暖機の成否で書かれるので、
// 「この版の起動をもう報告したか」とは意味が違う
export const LAST_BOOT_REPORT_VERSION_KEY = 'qr-search:boot-reported-version'

export interface SlowResource {
  // 短くした名前 (末尾 2 区切りぶん)。ハッシュ付きの長い URL をそのまま
  // 並べると 1 行が読めない
  name: string
  durationMs: number
  // Service Worker を経由したか。経由していれば、この時間には sw.js の
  // cacheFirst (fetch + cache.put の待ち) が含まれる
  viaWorker: boolean
}

export interface BootTiming {
  // navigate / reload / back_forward。PWA の起動は navigate になる
  navType: string
  // Worker の起動にかかった時間。null は「Worker を通らなかった」
  // (仕様上 workerStart の 0 は 0ms ではなく未経由の意)
  workerStartMs: number | null
  requestStartMs: number
  // **ここが切り分けの本体**。伸びていればサーバ側の待ち
  responseStartMs: number
  responseEndMs: number
  domContentLoadedMs: number
  loadMs: number
  // 最初に何かが描かれた時刻 = 白い時間の終わり。取れない環境では null
  firstContentfulPaintMs: number | null
  slowResources: SlowResource[]
}

export interface BootEnv {
  // アプリの版 (package.json)
  version: string
  // このページを管理している Worker が登録された版 (sw.js?v=…)。
  // アプリの版と食い違っていれば「古い Worker が起動を捌いた」と判る
  workerVersion: string | null
  // ホーム画面から開いたか (PWA)。症状は PWA でだけ報告されている
  standalone: boolean
  online: boolean
}

// 外から来る形は信じない (performance の実装差・古い環境)
function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

interface EntrySource {
  getEntriesByType?: (type: string) => unknown[]
}

function entriesOf(perf: unknown, type: string): unknown[] {
  const get = (perf as EntrySource | undefined)?.getEntriesByType
  if (typeof get !== 'function') {
    return []
  }
  try {
    const entries = get.call(perf, type)
    return Array.isArray(entries) ? entries : []
  } catch {
    // 対応していない type を渡すと投げる実装がある
    return []
  }
}

// URL の末尾 2 区切り (static/chunks/abc.js → chunks/abc.js)。
// 解析できない名前はそのまま短く切る
function shortResourceName(name: string): string {
  try {
    return new URL(name).pathname.split('/').filter(Boolean).slice(-2).join('/')
  } catch {
    return name.slice(-40)
  }
}

function readSlowResources(perf: unknown): SlowResource[] {
  return entriesOf(perf, 'resource')
    .map((entry) => {
      const { name, duration, workerStart } = entry as {
        name?: unknown
        duration?: unknown
        workerStart?: unknown
      }
      return {
        name: shortResourceName(typeof name === 'string' ? name : ''),
        durationMs: Math.round(readNumber(duration)),
        viaWorker: readNumber(workerStart) > 0,
      }
    })
    .filter((resource) => resource.durationMs >= SLOW_RESOURCE_FLOOR_MS)
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, SLOW_RESOURCE_LIMIT)
}

// 最初の画面読み込みの内訳。測れない環境では null。
// 引数はテストのため (既定は globalThis.performance)。
//
// **load が終わってから呼ぶこと。** loadEventEnd はそれまで 0 で、
// 内訳の右端が欠けた行になる。
export function readBootTiming(
  perf: unknown = typeof performance !== 'undefined' ? performance : undefined,
): BootTiming | null {
  const navigation = entriesOf(perf, 'navigation')[0] as
    | Record<string, unknown>
    | undefined
  if (!navigation) {
    return null
  }

  const paint = entriesOf(perf, 'paint').find(
    (entry) => (entry as { name?: unknown }).name === 'first-contentful-paint',
  ) as { startTime?: unknown } | undefined

  const workerStart = readNumber(navigation.workerStart)

  return {
    navType: typeof navigation.type === 'string' ? navigation.type : '不明',
    workerStartMs: workerStart > 0 ? workerStart : null,
    requestStartMs: readNumber(navigation.requestStart),
    responseStartMs: readNumber(navigation.responseStart),
    responseEndMs: readNumber(navigation.responseEnd),
    domContentLoadedMs: readNumber(navigation.domContentLoadedEventEnd),
    loadMs: readNumber(navigation.loadEventEnd),
    firstContentfulPaintMs: paint ? readNumber(paint.startTime) : null,
    slowResources: readSlowResources(perf),
  }
}

// 白かった時間。FCP が取れればそれが答えで、取れない環境では受信完了で代用する
// (SSR なので、HTML が届き切っていれば描けているはず)。
export function whiteScreenMs(timing: BootTiming): number {
  return timing.firstContentfulPaintMs ?? timing.responseEndMs
}

// 報告すべきか。**版が変わった最初の起動は速くても報告する** — 症状が出るのは
// まさにそこで、「遅くならなかった」ことも同じくらい知りたいため。
export function shouldReportBoot(
  timing: BootTiming,
  lastReportedVersion: string | null,
  version: string,
): boolean {
  return lastReportedVersion !== version || whiteScreenMs(timing) >= SLOW_BOOT_MS
}

// 管理している Worker の登録 URL (?v=…) から版を読む。
// null / 版が無い / 解析できないときは null。
export function parseWorkerVersion(scriptUrl: string | null): string | null {
  if (scriptUrl === null) {
    return null
  }
  try {
    return new URL(scriptUrl).searchParams.get('v')
  } catch {
    return null
  }
}

function ms(value: number): string {
  return `${Math.round(value)}ms`
}

// /logs に 1 行で並べる。左から右へ時間の流れ順にする — どこで止まったかは、
// 数字を読み比べるより「どこで急に増えたか」で判るため。
export function formatBootTiming(timing: BootTiming, env: BootEnv): string {
  const head = [
    `[起動] v${env.version}`,
    env.workerVersion === null ? 'SW無し' : `SW v${env.workerVersion}`,
    env.standalone ? 'PWA' : 'ブラウザ',
    env.online ? 'オンライン' : '圏外',
    timing.navType,
  ].join(' / ')

  const flow = [
    `要求 ${ms(timing.requestStartMs)}`,
    `応答待ち ${ms(timing.responseStartMs)}`,
    `受信 ${ms(timing.responseEndMs)}`,
    timing.firstContentfulPaintMs === null
      ? 'FCP不明'
      : `FCP ${ms(timing.firstContentfulPaintMs)}`,
    `DCL ${ms(timing.domContentLoadedMs)}`,
    `load ${ms(timing.loadMs)}`,
  ].join(' → ')

  const worker =
    timing.workerStartMs === null ? 'SW仲介なし' : `SW起動 ${ms(timing.workerStartMs)}`

  const slow =
    timing.slowResources.length === 0
      ? '遅い資源なし'
      : `遅い資源: ${timing.slowResources
          .map((r) => `${r.name} ${ms(r.durationMs)}${r.viaWorker ? '(SW)' : ''}`)
          .join(', ')}`

  return [head, flow, worker, slow].join(' | ')
}
