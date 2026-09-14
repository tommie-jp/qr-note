// クライアントサイド OCR のメインスレッド側の窓口 (docs/24-画像OCR計画.md §9-1)。
//
// 実体 (SDK + OpenCV.js + onnxruntime + モデル) は ocrWorker.ts の中だけに置き、
// ここは Worker を 1 つ抱えて要求と応答を Promise で対応づけるだけ。画像は
// サーバへ再送しない。
//
// **なぜ Worker か (メモリ)**: 以前はメインスレッドで SDK を直接動かしていたが、
// WebAssembly.Memory は grow しかできないため、確保した数百 MB がタブに残り
// 続けた。SPA 遷移では realm が変わらないので編集画面を離れても解放されず、
// 後から開いた画像検索がモデルを積めずに落ちていた (実機 iPhone)。SDK の
// dispose() では ORT セッションを release してもヒープの高水位は縮まず、むしろ
// 作り直しで伸びて悪化した (v0.18.0 で実証)。**terminate して realm ごと捨てる**
// のが唯一メモリを OS へ返す方法なので、そのために Worker へ移した。
//
// **Worker で組めない環境への三段構え** (docs/24 §9-2):
//   1. Worker で初期化 (本命。iPhone・普通の PC はここで終わる)
//   2. 失敗したら Worker を 1 度だけ作り直して再試行 (embedder と同じ。
//      一時的な失敗を新しい realm で救う)
//   3. それでも駄目ならメインスレッドで実行 (ocrMainFallback.ts)。実測:
//      constrained な Windows Chrome (ヒープ上限 1120MB) は Worker realm で
//      認識モデルの 16.5MB を確保できないが、メインスレッドでは組めていた
//
// **公式 SDK を使う理由 (縦書き)**: 以前使っていた ppu-paddle-ocr は検出した
// 矩形をそのまま認識にかけるため、日本語の縦書きがほぼ読めなかった。公式 SDK は
// 「縦横比 1.5 以上のクロップは 90 度回してから認識」を実装しており、
// 縦書きの列を認識できる (docs/24 §2)。
//
// このモジュールはブラウザでのみ呼ぶ。サーバ側からは絶対に import しないこと。

import { logDiagEvent, logEnvironmentOnce } from '@/lib/logging/diagLog'
import type { FromOcrWorker, ToOcrWorker } from './ocrWorkerMessages'

// 「モデルの準備が終わった」の合図。バイト計は 99 で頭打ちにしてあるので、
// この値だけが完了 (成功・失敗を問わず購読者が表示を畳んでよい) を意味する
export const MODEL_READY_PERCENT = 100

interface Pending {
  resolve: (quote: string) => void
  reject: (error: Error) => void
  // Worker を作り直したとき・フォールバックへ落ちたときに要求を出し直すため、
  // 入力も持っておく (Worker へは structured clone で渡るので手元に残る)
  blob: Blob
}

let worker: Worker | null = null
let ready = false
const pending = new Map<number, Pending>()
let nextId = 1

// Worker を起こした時刻 (performance.now)。準備完了までの秒数を診断ログに出す
let spawnedAt: number | null = null

// いまの Worker の初期化失敗を処理済みか。preload と要求の両方が失敗すると
// load-error が二重に届くため、二重に作り直さないための印
let handledLoadError = false

// 作り直しは 1 度だけ (ページの寿命の中で)。数えないと失敗が続く環境で
// 「作り直し → 21MB 取得 → 失敗」を無限に繰り返す
let retriedInit = false

// メインスレッド・フォールバックに落ちたか。一度落ちたら以後の OCR は
// 直接そちらへ (この環境の Worker は組めないと分かっているため)
let useFallback = false

// モデルダウンロードの進捗 % の購読者 (バナー表示用)。実行系 (Worker /
// フォールバック) がどれでも、進捗のチャネルはこの 1 本を通る
let modelProgressListeners: readonly ((percent: number) => void)[] = []

// 直前に通知した %。チャンク到着ごとに同じ整数を流すと購読者 (React state)
// が無駄に再描画されるため、値が変わったときだけ通知する
let lastNotifiedPercent: number | null = null

// モデル DL の % を購読する。戻り値で解除。MODEL_READY_PERCENT が
// 「準備終了」の合図 (DL 完了後の展開・ORT 初期化が残るため、
// バイト数だけでは 100 にしない)
export function subscribeModelProgress(
  listener: (percent: number) => void,
): () => void {
  modelProgressListeners = [...modelProgressListeners, listener]
  return () => {
    modelProgressListeners = modelProgressListeners.filter((l) => l !== listener)
  }
}

function notifyModelProgress(percent: number): void {
  if (percent === lastNotifiedPercent) {
    return
  }
  lastNotifiedPercent = percent
  for (const listener of modelProgressListeners) {
    listener(percent)
  }
}

// 未解決の要求をまとめて落とす。放っておくと呼び手が永遠に待つ
function rejectPending(reason: string): void {
  for (const entry of pending.values()) {
    entry.reject(new Error(reason))
  }
  pending.clear()
}

// Worker 起動からの経過秒 (表示用に 1 桁で丸める)
function elapsedSec(): string {
  if (spawnedAt === null) {
    return '?'
  }
  return ((performance.now() - spawnedAt) / 1000).toFixed(1)
}

// 復旧 (作り直し / フォールバック) までの待ち時間。
//
// **すぐに次を試してはいけない** (実測: constrained な Windows Chrome)。
// terminate した realm の wasm メモリの回収は非同期で、失敗直後に次の realm で
// OpenCV + ORT を積むと、死んだ realm のぶんがまだ返っておらず同じ確保失敗を
// 繰り返す。実機ログでは 6 秒間に realm を 3 つ渡り歩いて全滅した
// (フォールバックのメインスレッドまで巻き添え)。待てば返る見込みがある —
// 同じ機械で v0.18.0 のメインスレッド実行 (連続確保なし) は動いていた
const RESPAWN_DELAY_MS = 1_000
const FALLBACK_DELAY_MS = 3_000

// 進行中の復旧待ちタイマー。disposeOcr (画面離脱) で取り消す —
// 放っておくと、誰も待っていないのにモデルの取得が始まる
let recoveryTimer: ReturnType<typeof setTimeout> | null = null

// Worker の初期化失敗 (load-error / 起動不能) を三段構えで進める。
function handleInitFailure(message: string): void {
  if (handledLoadError) {
    return // preload と要求の二重報告。1 回だけ進める
  }
  handledLoadError = true
  console.warn('OCR モデルを Worker で読み込めませんでした', message)

  // まず捨てて、メモリの回収を始めさせる (次を積むのは待ってから)
  worker?.terminate()
  worker = null
  spawnedAt = null

  if (!retriedInit) {
    retriedInit = true
    logDiagEvent('[OCR] 読み込み失敗 → 1秒待って Worker を作り直す')
    recoveryTimer = setTimeout(() => {
      recoveryTimer = null
      spawnWorker()
    }, RESPAWN_DELAY_MS)
    return
  }

  useFallback = true
  logDiagEvent('[OCR] Worker で組めない → 3秒待ってメインスレッドで実行 (フォールバック)')
  recoveryTimer = setTimeout(() => {
    recoveryTimer = null
    // 待っている間に増えた要求も含めて流し込む
    const entries = [...pending.values()]
    pending.clear()
    for (const entry of entries) {
      runFallback(entry.blob).then(entry.resolve, entry.reject)
    }
  }, FALLBACK_DELAY_MS)
}

// フォールバック実行 1 件。進捗 % は同じ購読チャネルへ流し、結末で
// バナーを畳ませる (成功・失敗どちらでも MODEL_READY_PERCENT を流す)
async function runFallback(blob: Blob): Promise<string> {
  try {
    const { ocrOnMainThread } = await import('./ocrMainFallback')
    const quote = await ocrOnMainThread(blob, notifyModelProgress)
    ready = true
    notifyModelProgress(MODEL_READY_PERCENT)
    return quote
  } catch (err) {
    notifyModelProgress(MODEL_READY_PERCENT)
    throw err
  }
}

function handleMessage(msg: FromOcrWorker): void {
  if (msg.type === 'model-progress') {
    notifyModelProgress(msg.percent)
    return
  }
  if (msg.type === 'ready') {
    if (!ready) {
      // ready は OCR のたびに届くが、診断に要るのは初回 (モデル準備) だけ
      logDiagEvent(`[OCR] モデル準備完了 (${elapsedSec()}秒)`)
    }
    ready = true
    notifyModelProgress(MODEL_READY_PERCENT)
    return
  }
  if (msg.type === 'load-error') {
    // ここではバナーを畳まない (作り直し・フォールバックでまだ準備は続く)。
    // 最終的な結末は runFallback が流す
    handleInitFailure(msg.message)
    return
  }
  const entry = pending.get(msg.id)
  if (!entry) {
    return
  }
  pending.delete(msg.id)
  if (msg.type === 'result') {
    entry.resolve(msg.quote)
    return
  }
  entry.reject(new Error(msg.message))
}

// Worker を起こし、待っている要求を出し直す (作り直し時)。
function spawnWorker(): void {
  worker?.terminate()
  // どんな端末かを 1 度だけ添える (32bit ブラウザの特定に丸一日かかった。
  // ビット数・RAM が /logs に出ていれば一目で分かった)
  logEnvironmentOnce()
  logDiagEvent('[OCR] Worker 起動')
  spawnedAt = performance.now()
  handledLoadError = false
  // 作り直しでは % を最初から流し直す
  lastNotifiedPercent = null
  const created = new Worker(new URL('./ocrWorker.ts', import.meta.url), {
    type: 'module',
  })
  created.onmessage = (event: MessageEvent<FromOcrWorker>) => {
    handleMessage(event.data)
  }
  // Worker 自体が起動できない (チャンクの 404、import の失敗など) と onmessage は
  // 一生呼ばれない。拾わないと「準備しています」で固まる。初期化失敗と同じ
  // 三段構えに乗せる
  created.onerror = (event: ErrorEvent) => {
    handleInitFailure(event.message || 'OCR の Worker を起動できませんでした')
  }
  worker = created
  // 最初の要求を待たずにモデルを読み始める。初期化の失敗をここで確実に
  // 拾えるようにする意味もある (要求が無いと失敗も届かない)
  created.postMessage({ type: 'preload' } satisfies ToOcrWorker)
  // 待っている要求を新しい Worker へ出し直す
  for (const [id, entry] of pending) {
    created.postMessage({ type: 'ocr', id, blob: entry.blob } satisfies ToOcrWorker)
  }
}

function getWorker(): Worker {
  if (!worker) {
    spawnWorker()
  }
  return worker!
}

// 初回のモデル読み込みが済んでいるか。UI が「準備中」と「処理中」を
// 出し分けるのに使う。
export function isOcrReady(): boolean {
  return ready
}

// 初回ロードを前もって温めたいとき用 (今は未使用だが、編集画面を開いた時点で
// 走らせる導線を足せるようにしておく)。
export function preloadOcr(): void {
  if (!useFallback) {
    getWorker()
  }
}

// OCR の Worker を落とし、抱えていたメモリを OS へ返す。
//
// 編集画面を離れるとき (editor/hooks/useEditorOcr.ts) と、画像検索を開くとき
// (ImageSearchModal) に呼ぶ。**terminate は realm ごと捨てる**ので、
// OpenCV と onnxruntime が確保した wasm ヒープがまるごと返る
// (SDK の dispose() では縮まなかった。冒頭のコメント参照)。
//
// 走っている OCR があっても待たない: 呼ぶのは編集画面が閉じた後か、
// メモリを空けたい画像検索の直前で、どちらも結果の行き先が無い。
// 待っている呼び手には理由を伝えて落とす。
//
// フォールバック (メインスレッド) に落ちた環境では解放できるものが無い
// (realm を捨てられないのがフォールバックの代償。ocrMainFallback.ts 参照)。
//
// reason は診断ログに出す「なぜ落としたか」(例: '編集画面を離脱')。
// 実機調査で「画像検索の前に OCR は本当に死んでいたか」を /logs で
// 証明するのに要る。
export function disposeOcr(reason: string): void {
  // 復旧待ちも取り消す。放っておくと、誰も待っていないのに
  // モデルの取得 (Worker 作り直し / フォールバック) が始まる
  if (recoveryTimer !== null) {
    clearTimeout(recoveryTimer)
    recoveryTimer = null
  }
  if (worker) {
    logDiagEvent(`[OCR] Worker 破棄 (${reason})`)
    worker.terminate()
    worker = null
    ready = false
    spawnedAt = null
    lastNotifiedPercent = null
  }
  rejectPending('OCR を終了しました')
}

// 画像 1 枚を OCR し、日本語優先で整えた引用ブロックを返す。
// 文字が取れなければ空文字を返す (呼び手はこれを「見つからなかった」に使う)。
//
// 認識は Worker の中で走るので、メインスレッド (入力・描画) は塞がらない
// (フォールバックに落ちた環境を除く)。
export function ocrImageToQuote(blob: Blob): Promise<string> {
  // 復旧待ちの間に来た要求は積むだけにする (Worker を今すぐ起こすと、
  // メモリの回収を待つという復旧の意味が消える)。作り直し時の出し直し /
  // フォールバックの流し込みが拾ってくれる
  if (recoveryTimer !== null) {
    const id = nextId++
    return new Promise<string>((resolve, reject) => {
      pending.set(id, { resolve, reject, blob })
    })
  }
  if (useFallback) {
    return runFallback(blob)
  }
  // 先に Worker を確保してから pending に載せる。逆にすると、初回 spawn の
  // 「待っている要求の出し直し」がこの要求も拾い、二重に送ってしまう
  const target = getWorker()
  const id = nextId++
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject, blob })
    target.postMessage({ type: 'ocr', id, blob } satisfies ToOcrWorker)
  })
}
