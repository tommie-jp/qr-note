// 画像埋め込みの Web Worker (docs/25-画像検索計画.md §6)。
//
// カメラフレーム (ImageBitmap) を受け取り、OffscreenCanvas に描いて
// embedder.embed() に渡し、正規化済みベクトルを返す。重い推論をここに閉じ込め、
// メインスレッド (カメラ描画・UI) を塞がない。
//
// transformers.js 本体・モデルは embedder 側で最初の embed 時に動的 import される。
// この Worker を new Worker(new URL('./embedWorker.ts', import.meta.url)) で
// 起こすと、turbopack が transformers.js を Worker 用チャンクに束ねる。

/// <reference lib="webworker" />

import { type CaptureScope, installClientLogCapture } from '@/lib/logging/clientCapture'
import { sendClientLogs } from '@/lib/logging/clientTransport'
import { embed, getAttemptedDevice, preloadEmbedder } from '@/lib/embedding/embedder'
import type { FromEmbedWorker, ToEmbedWorker } from './workerMessages'

const ctx = self as unknown as DedicatedWorkerGlobalScope

// ここのログは**どこにも出ない**まま消える (docs/30-ブラウザログ計画.md §3)。
// Worker は別スレッドで console も別なので、メインスレッドの拾い手にも
// eruda にも乗らない。モデル読み込みの失敗はこの中で起きるので、
// 同じ仕掛けをここでも掛ける (拾い手は window に依存しない作りにしてある)
installClientLogCapture({
  scope: ctx as unknown as CaptureScope,
  send: sendClientLogs,
})

// 初回モデル読み込みが済んだら 1 度だけ ready を送る。
let announcedReady = false
function announceReadyOnce(): void {
  if (announcedReady) {
    return
  }
  announcedReady = true
  post({ type: 'ready' })
}

function post(message: FromEmbedWorker, transfer?: Transferable[]): void {
  ctx.postMessage(message, transfer ?? [])
}

// ImageBitmap → OffscreenCanvas → 埋め込み。
async function embedBitmap(bitmap: ImageBitmap): Promise<Float32Array> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const c2d = canvas.getContext('2d')
  if (!c2d) {
    throw new Error('OffscreenCanvas の 2D コンテキストを取得できませんでした')
  }
  c2d.drawImage(bitmap, 0, 0)
  bitmap.close()
  return embed(canvas)
}

ctx.onmessage = async (event: MessageEvent<ToEmbedWorker>) => {
  const msg = event.data

  if (msg.type === 'preload') {
    // 読み込めたら即 ready (最初のフレームを待たなくてよい)。落ちたら理由を
    // そのまま返す。ここを握りつぶすと UI が原因を言えなくなる。
    // この Worker では再試行しない (同一 realm では必ず失敗する。embedder.ts の
    // getExtractor 参照)。作り直すかどうかはメイン側が決める
    preloadEmbedder(msg.forceWasm).then(announceReadyOnce, (err: unknown) => {
      post({
        type: 'load-error',
        message: String(err),
        device: getAttemptedDevice(),
      })
    })
    return
  }

  // type === 'embed'
  try {
    const vector = await embedBitmap(msg.bitmap)
    announceReadyOnce()
    // buffer を transfer して余計なコピーを避ける
    post({ type: 'result', id: msg.id, vector }, [vector.buffer])
  } catch (err) {
    // フレームが壊れていても Worker は生かす (次のフレームで直りうる)。
    // ただし bitmap は閉じてリークを防ぐ (embedBitmap 前で投げた場合に備える)
    msg.bitmap.close?.()
    post({ type: 'error', id: msg.id, message: String(err) })
  }
}
