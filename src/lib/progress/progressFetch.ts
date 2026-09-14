// 受信バイトを数えながら中身を素通しする fetch ラッパー。
// PaddleOCR SDK の `fetch` オプションに渡し、モデル (.tar) ダウンロードの
// 進捗 % を出すのに使う (ocrService.ts)。SDK は det/rec の 2 本を並行で
// 取るため、onProgress には「その時点の全ダウンロードのスナップショット」を
// 渡す (% への合算は progress/progress.ts の aggregatePercent)。

import type { DownloadState } from './progress'

export function createProgressFetch(
  onProgress: (downloads: readonly DownloadState[]) => void,
  baseFetch: typeof fetch = fetch,
): typeof fetch {
  // このラッパー経由で始まった全ダウンロードの現在値。更新は差し替えで行い、
  // onProgress へはこの配列をそのまま渡す (要素も配列も作り直すので安全)
  let downloads: readonly DownloadState[] = []

  const update = (index: number, loadedDelta: number) => {
    downloads = downloads.map((d, i) =>
      i === index ? { ...d, loaded: d.loaded + loadedDelta } : d,
    )
    onProgress(downloads)
  }

  return async (input, init) => {
    const response = await baseFetch(input, init)
    if (!response.ok || response.body === null) {
      // エラー応答はそのまま返す (中身の解釈は SDK 側の仕事)
      return response
    }

    const contentLength = Number(response.headers.get('content-length'))
    const total =
      Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null
    const index = downloads.length
    downloads = [...downloads, { loaded: 0, total }]

    const reader = response.body.getReader()
    const counting = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await reader.read()
        if (done) {
          controller.close()
          return
        }
        update(index, value.byteLength)
        controller.enqueue(value)
      },
      cancel(reason) {
        return reader.cancel(reason)
      },
    })

    return new Response(counting, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }
}
