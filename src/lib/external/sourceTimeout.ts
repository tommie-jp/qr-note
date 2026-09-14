// 外部 API の取得ごとに時間の上限を持つ (設計は docs/13-書誌自動取得計画.md §4)。
// 1 つの API が黙り込んでも新規登録の導線を吊るさないための共通部品で、
// bookLookup (openBD / NDL サーチ) と productLookup (Yahoo!ショッピング) が使う。
//
// 実測の応答は openBD 30ms、NDL 30ms〜3 秒 (未キャッシュの ISBN)、
// Yahoo!ショッピング 1 秒未満なので 8 秒は余る。

export const SOURCE_TIMEOUT_MS = 8000

// 外側の signal (中断) を生かしたまま、この 1 回だけの上限を足す。
// AbortSignal.any は環境によっては無いため、素の AbortController で組む。
//
// timeoutMs は既定 (1 つの API に 8 秒) 以外を使うときだけ渡す。書影は
// おまけなので、取得ぜんぶで書誌より短い上限にしている (external/coverImage.ts)。
export async function withSourceTimeout<T>(
  signal: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number = SOURCE_TIMEOUT_MS,
): Promise<T> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), timeoutMs)
  const forward = () => abort.abort(signal?.reason)
  signal?.addEventListener('abort', forward, { once: true })
  try {
    return await run(abort.signal)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', forward)
  }
}
