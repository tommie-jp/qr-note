// ocrService (メインスレッド側の窓口) のテスト (docs/24-画像OCR計画.md §9-1,9-2)。
//
// 見たいのは Worker との配線と三段構え: 要求と応答の対応づけ、進捗の中継、
// **terminate でメモリを返す**こと、そして「Worker 失敗 → 作り直し →
// メインスレッド・フォールバック」の順で進むこと。ここが壊れても画面上は
// 分かりにくく、実機 (iPhone / constrained な Windows) を出すまで気づけない。
//
// Worker は jsdom に無いので差し替える。OCR の中身 (SDK・モデル) は
// ocrWorker.ts / ocrMainFallback.ts 側なので、ここでは一切読み込まない。

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { FromOcrWorker, ToOcrWorker } from './ocrWorkerMessages'

// 診断イベント (diagLog) は fetch へ直行するのでテストでは黙らせて記録する
const diag = vi.hoisted(() => ({ events: [] as string[] }))
vi.mock('@/lib/logging/diagLog', () => ({
  logDiagEvent: (text: string) => {
    diag.events.push(text)
  },
  logEnvironmentOnce: () => {},
}))

// メインスレッド・フォールバックは動的 import されるので差し替えて記録する
const fallback = vi.hoisted(() => ({
  calls: [] as Blob[],
  result: '> フォールバックの結果' as string | Error,
}))
vi.mock('./ocrMainFallback', () => ({
  ocrOnMainThread: async (blob: Blob, onPercent: (p: number) => void) => {
    fallback.calls.push(blob)
    onPercent(55)
    if (fallback.result instanceof Error) {
      throw fallback.result
    }
    return fallback.result
  },
}))

// 生成された偽 Worker を順に記録する (terminate 後の作り直しを見るため)
const workers: FakeWorker[] = []

class FakeWorker {
  postMessage = vi.fn<(message: ToOcrWorker) => void>()
  terminate = vi.fn()
  onmessage: ((event: MessageEvent<FromOcrWorker>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null

  constructor() {
    workers.push(this)
  }

  // Worker からの応答を流す
  emit(message: FromOcrWorker): void {
    this.onmessage?.({ data: message } as MessageEvent<FromOcrWorker>)
  }

  // 受け取った OCR 要求 (preload は除く)
  ocrRequests(): Extract<ToOcrWorker, { type: 'ocr' }>[] {
    return this.postMessage.mock.calls
      .map(([m]) => m)
      .filter((m): m is Extract<ToOcrWorker, { type: 'ocr' }> => m.type === 'ocr')
  }
}

vi.stubGlobal('Worker', FakeWorker)

// モジュールの singleton をテスト間で持ち越さないよう毎回読み込み直す
async function loadService() {
  vi.resetModules()
  workers.length = 0
  return import('./ocrService')
}

beforeEach(() => {
  workers.length = 0
  diag.events.length = 0
  fallback.calls.length = 0
  fallback.result = '> フォールバックの結果'
})

// terminate で落とされる要求を受け取っておくヘルパ。放っておくと未処理の
// rejection になり、本物の失敗が埋もれる
function expectRejection(promise: Promise<unknown>): Promise<unknown> {
  return expect(promise).rejects.toThrow()
}

describe('ocrImageToQuote (正常系)', () => {
  test('spawns the worker with a preload so init failures surface without a request', async () => {
    // Arrange / Act
    const ocr = await loadService()
    ocr.ocrImageToQuote(new Blob()).catch(() => {})

    // Assert
    expect(workers).toHaveLength(1)
    expect(workers[0].postMessage.mock.calls[0][0]).toEqual({ type: 'preload' })
  })

  test('resolves with the quote the worker sends back', async () => {
    // Arrange
    const ocr = await loadService()
    const quote = ocr.ocrImageToQuote(new Blob())
    const [request] = workers[0].ocrRequests()

    // Act
    workers[0].emit({ type: 'result', id: request.id, quote: '> あいう' })

    // Assert
    await expect(quote).resolves.toBe('> あいう')
  })

  test('sends each request exactly once on the first spawn', async () => {
    // Arrange / Act: spawn 時の「出し直し」と要求自身の送信が重複しないこと
    const ocr = await loadService()
    ocr.ocrImageToQuote(new Blob()).catch(() => {})

    // Assert
    expect(workers[0].ocrRequests()).toHaveLength(1)
  })

  test('keeps concurrent requests apart by id', async () => {
    // Arrange: 複数画像を続けて OCR できるので同時実行が起こる
    const ocr = await loadService()
    const first = ocr.ocrImageToQuote(new Blob())
    const second = ocr.ocrImageToQuote(new Blob())
    const ids = workers[0].ocrRequests().map((m) => m.id)

    // Act: 2 本目を先に返す
    workers[0].emit({ type: 'result', id: ids[1], quote: '2 本目' })
    workers[0].emit({ type: 'result', id: ids[0], quote: '1 本目' })

    // Assert
    await expect(first).resolves.toBe('1 本目')
    await expect(second).resolves.toBe('2 本目')
  })

  test('rejects when the worker reports a per-image failure', async () => {
    // Arrange
    const ocr = await loadService()
    const quote = ocr.ocrImageToQuote(new Blob())
    const [request] = workers[0].ocrRequests()

    // Act
    workers[0].emit({ type: 'error', id: request.id, message: '読めません' })

    // Assert
    await expect(quote).rejects.toThrow('読めません')
  })
})

describe('三段構え (Worker 失敗 → 作り直し → メインスレッド)', () => {
  // 復旧は待ってから進む (terminate した realm のメモリ回収を待つ) ので、
  // タイマーを進めて次の段へ送る
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test('respawns a fresh worker on the first load failure and re-sends the request', async () => {
    // Arrange
    const ocr = await loadService()
    const quote = ocr.ocrImageToQuote(new Blob())
    const [request] = workers[0].ocrRequests()

    // Act: 初期化失敗 → 前の Worker は即捨てる (メモリ回収を始めさせる)
    workers[0].emit({ type: 'load-error', message: 'boom' })

    // Assert: 待ちの間はまだ作り直さない
    expect(workers[0].terminate).toHaveBeenCalled()
    expect(workers).toHaveLength(1)

    // Act: 待ちが明けると、新しい Worker に同じ id で出し直される
    await vi.advanceTimersByTimeAsync(1_000)
    expect(workers).toHaveLength(2)
    expect(workers[1].ocrRequests().map((m) => m.id)).toEqual([request.id])
    workers[1].emit({ type: 'result', id: request.id, quote: '> 救えた' })

    // Assert
    await expect(quote).resolves.toBe('> 救えた')
  })

  test('queues requests made during the recovery wait', async () => {
    // Arrange: 待ちの間に来た要求で Worker を今すぐ起こすと、
    // メモリの回収を待つ意味が消える
    const ocr = await loadService()
    const first = ocr.ocrImageToQuote(new Blob())
    workers[0].emit({ type: 'load-error', message: 'boom' })

    // Act: 待ちの間の 2 本目
    const second = ocr.ocrImageToQuote(new Blob())
    expect(workers).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1_000)

    // Assert: 明けた時点で両方出し直される
    const ids = workers[1].ocrRequests().map((m) => m.id)
    expect(ids).toHaveLength(2)
    workers[1].emit({ type: 'result', id: ids[0], quote: '1 本目' })
    workers[1].emit({ type: 'result', id: ids[1], quote: '2 本目' })
    await expect(first).resolves.toBe('1 本目')
    await expect(second).resolves.toBe('2 本目')
  })

  test('cancels a pending recovery when the screen is left', async () => {
    // Arrange: 誰も待っていないのにモデルの取得が始まるのを防ぐ
    const ocr = await loadService()
    const abandoned = expectRejection(ocr.ocrImageToQuote(new Blob()))
    workers[0].emit({ type: 'load-error', message: 'boom' })

    // Act
    ocr.disposeOcr('編集画面を離脱')
    await vi.advanceTimersByTimeAsync(10_000)

    // Assert: 作り直しは起きない
    expect(workers).toHaveLength(1)
    await abandoned
  })

  test('ignores a duplicated load failure from the same worker', async () => {
    // Arrange: preload と要求の両方が失敗すると load-error は二重に届く
    const ocr = await loadService()
    ocr.ocrImageToQuote(new Blob()).catch(() => {})

    // Act
    workers[0].emit({ type: 'load-error', message: 'boom' })
    workers[0].emit({ type: 'load-error', message: 'boom' })
    await vi.advanceTimersByTimeAsync(10_000)

    // Assert: 作り直しは 1 回だけ (2 重に作ると 21MB の取得が並走する)
    expect(workers).toHaveLength(2)
  })

  test('falls back to the main thread when the respawned worker also fails', async () => {
    // Arrange
    const ocr = await loadService()
    const quote = ocr.ocrImageToQuote(new Blob())

    // Act: 1 度目の失敗 → (1秒) 作り直し、2 度目の失敗 → (3秒) フォールバック
    workers[0].emit({ type: 'load-error', message: 'boom' })
    await vi.advanceTimersByTimeAsync(1_000)
    workers[1].emit({ type: 'load-error', message: 'boom again' })
    await vi.advanceTimersByTimeAsync(3_000)

    // Assert: 待っていた要求はメインスレッドで処理される
    await expect(quote).resolves.toBe('> フォールバックの結果')
    expect(fallback.calls).toHaveLength(1)
    expect(workers[1].terminate).toHaveBeenCalled()
    expect(diag.events).toContain(
      '[OCR] Worker で組めない → 3秒待ってメインスレッドで実行 (フォールバック)',
    )
  })

  test('sends later requests straight to the fallback once latched', async () => {
    // Arrange: フォールバックへ落ちた後
    const ocr = await loadService()
    const first = ocr.ocrImageToQuote(new Blob())
    workers[0].emit({ type: 'load-error', message: 'boom' })
    await vi.advanceTimersByTimeAsync(1_000)
    workers[1].emit({ type: 'load-error', message: 'boom again' })
    await vi.advanceTimersByTimeAsync(3_000)
    await first

    // Act: 次の要求
    const second = ocr.ocrImageToQuote(new Blob())

    // Assert: Worker を作り直さない (この環境では組めないと分かっている)
    await expect(second).resolves.toBe('> フォールバックの結果')
    expect(workers).toHaveLength(2)
  })

  test('treats a worker boot failure (onerror) the same way', async () => {
    // Arrange: チャンクの 404 などで onmessage が一生呼ばれないケース
    const ocr = await loadService()
    const quote = ocr.ocrImageToQuote(new Blob())

    // Act
    workers[0].onerror?.({ message: 'Importing a module script failed.' } as ErrorEvent)
    await vi.advanceTimersByTimeAsync(1_000)
    workers[1].onerror?.({ message: 'Importing a module script failed.' } as ErrorEvent)
    await vi.advanceTimersByTimeAsync(3_000)

    // Assert
    await expect(quote).resolves.toBe('> フォールバックの結果')
  })

  test('rejects and folds the banner when even the fallback fails', async () => {
    // Arrange: 伝えないと「準備しています… 99%」が永久に残る
    fallback.result = new Error('Out of memory')
    const ocr = await loadService()
    const seen: number[] = []
    ocr.subscribeModelProgress((p) => seen.push(p))
    const quote = ocr.ocrImageToQuote(new Blob())
    // タイマーを進める間に reject が確定するので、先に待ち受けを張る
    // (張らないと未処理の rejection として警告される)
    const rejection = expect(quote).rejects.toThrow('Out of memory')

    // Act
    workers[0].emit({ type: 'load-error', message: 'boom' })
    await vi.advanceTimersByTimeAsync(1_000)
    workers[1].emit({ type: 'load-error', message: 'boom again' })
    await vi.advanceTimersByTimeAsync(3_000)

    // Assert
    await rejection
    expect(seen).toContain(ocr.MODEL_READY_PERCENT)
  })
})

describe('disposeOcr', () => {
  test('terminates the worker so the wasm heap goes back to the OS', async () => {
    // Arrange
    const ocr = await loadService()
    const abandoned = expectRejection(ocr.ocrImageToQuote(new Blob()))

    // Act
    ocr.disposeOcr('テスト')

    // Assert: dispose() ではヒープが縮まないので terminate でなければ意味がない
    expect(workers[0].terminate).toHaveBeenCalledTimes(1)
    await abandoned
  })

  test('starts a fresh worker for the next OCR', async () => {
    // Arrange
    const ocr = await loadService()
    const abandoned = expectRejection(ocr.ocrImageToQuote(new Blob()))
    ocr.disposeOcr('テスト')

    // Act
    ocr.ocrImageToQuote(new Blob()).catch(() => {})

    // Assert
    expect(workers).toHaveLength(2)
    expect(workers[1].terminate).not.toHaveBeenCalled()
    await abandoned
  })

  test('does nothing when no worker was ever started', async () => {
    // Arrange: OCR を 1 度も使わずに編集画面を離れた場合
    const ocr = await loadService()

    // Act
    ocr.disposeOcr('テスト')

    // Assert
    expect(workers).toHaveLength(0)
  })

  test('rejects in-flight requests instead of leaving them hanging', async () => {
    // Arrange
    const ocr = await loadService()
    const quote = ocr.ocrImageToQuote(new Blob())

    // Act
    ocr.disposeOcr('テスト')

    // Assert
    await expect(quote).rejects.toThrow('OCR を終了しました')
  })

  test('logs why the worker was killed (device-side diagnosis)', async () => {
    // Arrange: 実機調査では「画像検索の前に OCR は本当に死んでいたか」を
    // /logs で証明する必要がある
    const ocr = await loadService()
    const abandoned = expectRejection(ocr.ocrImageToQuote(new Blob()))

    // Act
    ocr.disposeOcr('画像検索を開く')

    // Assert
    expect(diag.events).toContain('[OCR] Worker 起動')
    expect(diag.events).toContain('[OCR] Worker 破棄 (画像検索を開く)')
    await abandoned
  })

  test('forgets that the model was ready', async () => {
    // Arrange
    const ocr = await loadService()
    const abandoned = expectRejection(ocr.ocrImageToQuote(new Blob()))
    workers[0].emit({ type: 'ready' })
    expect(ocr.isOcrReady()).toBe(true)

    // Act
    ocr.disposeOcr('テスト')

    // Assert: 次は読み直しになるので UI は「準備中」を出さないといけない
    expect(ocr.isOcrReady()).toBe(false)
    await abandoned
  })
})

describe('subscribeModelProgress', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test('relays download percentages from the worker', async () => {
    // Arrange
    const ocr = await loadService()
    const seen: number[] = []
    ocr.subscribeModelProgress((p) => seen.push(p))
    ocr.ocrImageToQuote(new Blob()).catch(() => {})

    // Act
    workers[0].emit({ type: 'model-progress', percent: 40 })
    workers[0].emit({ type: 'model-progress', percent: 70 })

    // Assert
    expect(seen).toEqual([40, 70])
  })

  test('does not repeat the same percentage', async () => {
    // Arrange: チャンク到着ごとに同じ整数を流すと購読者が無駄に再描画される
    const ocr = await loadService()
    const seen: number[] = []
    ocr.subscribeModelProgress((p) => seen.push(p))
    ocr.ocrImageToQuote(new Blob()).catch(() => {})

    // Act
    workers[0].emit({ type: 'model-progress', percent: 40 })
    workers[0].emit({ type: 'model-progress', percent: 40 })

    // Assert
    expect(seen).toEqual([40])
  })

  test('reports completion so the banner folds away', async () => {
    // Arrange
    const ocr = await loadService()
    const seen: number[] = []
    ocr.subscribeModelProgress((p) => seen.push(p))
    ocr.ocrImageToQuote(new Blob()).catch(() => {})

    // Act
    workers[0].emit({ type: 'ready' })

    // Assert
    expect(seen).toEqual([ocr.MODEL_READY_PERCENT])
  })

  test('restarts the percentages from scratch after a respawn', async () => {
    // Arrange: 作り直しでは 21MB を取り直すので % も最初から流し直す
    const ocr = await loadService()
    const seen: number[] = []
    ocr.subscribeModelProgress((p) => seen.push(p))
    ocr.ocrImageToQuote(new Blob()).catch(() => {})
    workers[0].emit({ type: 'model-progress', percent: 99 })

    // Act
    workers[0].emit({ type: 'load-error', message: 'boom' })
    await vi.advanceTimersByTimeAsync(1_000)
    workers[1].emit({ type: 'model-progress', percent: 10 })
    workers[1].emit({ type: 'model-progress', percent: 99 })

    // Assert: 99 → (作り直し) → 10 → 99 と、同値でも流れ直す
    expect(seen).toEqual([99, 10, 99])
  })

  test('stops relaying after unsubscribe', async () => {
    // Arrange
    const ocr = await loadService()
    const seen: number[] = []
    const unsubscribe = ocr.subscribeModelProgress((p) => seen.push(p))
    ocr.ocrImageToQuote(new Blob()).catch(() => {})

    // Act
    unsubscribe()
    workers[0].emit({ type: 'model-progress', percent: 40 })

    // Assert
    expect(seen).toEqual([])
  })
})
