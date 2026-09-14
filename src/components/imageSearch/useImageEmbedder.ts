// 埋め込み Worker をひとつ抱え、フレーム → ベクトルの往復を Promise で扱うフック
// (docs/25-画像検索計画.md §6)。id で要求と応答を対応づける。
//
// モデルの読み込みに失敗したら、**Worker を作り直して** WASM 強制で 1 度だけ
// 読み直す (iPhone は WebGPU のアダプタを返すのに初期化が OOM で落ちる)。
// 同一 Worker 内で組み直しても必ず失敗する理由は embedder.ts の getExtractor に
// 書いた。再試行するかどうかの判断は embedderLoadState の純関数が持つ。

import { useCallback, useEffect, useRef, useState } from 'react'
import { logDiagEvent, logEnvironmentOnce, readMemorySnapshot } from '@/lib/logging/diagLog'
import {
  INITIAL_EMBEDDER_LOAD_STATE,
  needsWasmRespawn,
  reduceEmbedderLoad,
  shouldStartWithWasm,
  type EmbedderLoadState,
} from './embedderLoadState'
import type { FromEmbedWorker, ToEmbedWorker } from './workerMessages'

interface Pending {
  resolve: (vector: Float32Array) => void
  reject: (error: Error) => void
}

export interface ImageEmbedder {
  // 初回モデル読み込みが完了したか (UI の「準備中(初回)」を畳むのに使う)
  ready: boolean
  // モデルの初回読み込みに失敗したか。WASM での再試行も駄目だったときだけ
  // 立つ。ライブ検索は失敗を握りつぶすので、これを UI に出さないと
  // 「カメラは映るが何も出ない」原因が分からなくなる
  failed: boolean
  // 失敗したときの生の理由。「通信環境を確認して」だけでは通信以外の原因
  // (端末のメモリ不足、自前配布アセットの欠落など) に辿り着けないので添えて出す。
  failureMessage: string | null
  // フレーム 1 枚 → 正規化済みベクトル。bitmap は Worker へ transfer される
  embed: (bitmap: ImageBitmap) => Promise<Float32Array>
}

export function useImageEmbedder(): ImageEmbedder {
  const workerRef = useRef<Worker | null>(null)
  const pendingRef = useRef(new Map<number, Pending>())
  const nextIdRef = useRef(1)
  // 読み込み状態はレンダーにも出すが、メッセージ処理の中では最新値を同期で
  // 見たいので ref にも持つ (state のクロージャは古い値を掴む)
  const loadStateRef = useRef(INITIAL_EMBEDDER_LOAD_STATE)
  const [loadState, setLoadState] = useState(INITIAL_EMBEDDER_LOAD_STATE)

  useEffect(() => {
    const pending = pendingRef.current
    // アンマウント後に Worker を起こし直さないための番兵
    let disposed = false

    // 未解決の要求をまとめて落とす。放っておくと呼び手が永遠に待つ
    const rejectPending = (reason: string) => {
      for (const entry of pending.values()) {
        entry.reject(new Error(reason))
      }
      pending.clear()
    }

    const applyEvent = (state: EmbedderLoadState) => {
      loadStateRef.current = state
      setLoadState(state)
    }

    const handleLoadFailure = (message: string) => {
      const prev = loadStateRef.current
      const next = reduceEmbedderLoad(prev, { type: 'load-failure', message })
      applyEvent(next)
      if (needsWasmRespawn(prev, next)) {
        spawn(true)
      }
    }

    function spawn(forceWasm: boolean): void {
      // 前の Worker は捨てる。realm を作り直さないと WASM で組み直せない
      workerRef.current?.terminate()
      workerRef.current = null
      rejectPending('画像検索モデルを読み込み直しています')
      if (disposed) {
        return
      }

      // どちらの経路で組み始めたかを実機調査用に残す (docs/30 §6)。
      // 失敗は console.warn (下) が拾うので、ここは開始の印だけでよい
      logEnvironmentOnce()
      logDiagEvent(
        `[画像検索] Worker 起動 (${forceWasm ? 'WASM 強制' : 'デバイス自動選択'})`,
      )
      const spawnedAt = performance.now()
      const worker = new Worker(new URL('./embedWorker.ts', import.meta.url), {
        type: 'module',
      })
      workerRef.current = worker

      worker.onmessage = (event: MessageEvent<FromEmbedWorker>) => {
        const msg = event.data
        if (msg.type === 'ready') {
          if (loadStateRef.current.phase !== 'ready') {
            logDiagEvent(
              `[画像検索] モデル準備完了 (${((performance.now() - spawnedAt) / 1000).toFixed(1)}秒)`,
            )
          }
          applyEvent(reduceEmbedderLoad(loadStateRef.current, { type: 'ready' }))
          return
        }
        if (msg.type === 'load-error') {
          // どちらのデバイスで落ちたかはコンソールにだけ残す。UI に出しても
          // 読み手に意味がないが、後から報告を追うときはこれが手掛かりになる
          console.warn(
            `画像検索モデルを ${msg.device} で読み込めませんでした`,
            msg.message,
          )
          handleLoadFailure(msg.message)
          return
        }
        const entry = pending.get(msg.id)
        if (!entry) {
          return
        }
        pending.delete(msg.id)
        if (msg.type === 'result') {
          entry.resolve(msg.vector)
          return
        }
        // フレーム 1 枚の失敗は読み込みの失敗として扱わない。Worker は必ず
        // preload するので、モデルを用意できなければ load-error が必ず来る。
        // ここで読み込み失敗に混ぜると、壊れたフレーム 1 枚で Worker を
        // 作り直して (読み込み中なら数十 MB の取得をやり直して) しまう
        entry.reject(new Error(msg.message))
      }

      // Worker 自体が起動できない (チャンクの 404、import の失敗など) と
      // onmessage は一生呼ばれない。拾わないと「準備しています」で固まる
      worker.onerror = (event: ErrorEvent) => {
        handleLoadFailure(event.message || 'Worker を起動できませんでした')
      }

      // モデルを前もって温める (最初のフレームを待たずに読み込み始める)
      worker.postMessage({ type: 'preload', forceWasm } satisfies ToEmbedWorker)
    }

    // ヒープ上限が小さい端末 (実測: constrained な Windows Chrome) では
    // 最初から WASM で組み、WebGPU の試行が OOM の引き金になるのを避ける。
    // 判断は shouldStartWithWasm (純関数)。数値が取れない端末 (iPhone) は
    // 従来どおり WebGPU から試す
    spawn(shouldStartWithWasm(readMemorySnapshot()))

    return () => {
      disposed = true
      workerRef.current?.terminate()
      workerRef.current = null
      // 未解決の要求は落とす (モーダルを閉じた後に resolve しても無意味)
      rejectPending('画像検索を終了しました')
    }
  }, [])

  const embed = useCallback((bitmap: ImageBitmap): Promise<Float32Array> => {
    const worker = workerRef.current
    if (!worker) {
      bitmap.close()
      return Promise.reject(new Error('Worker が準備できていません'))
    }
    const id = nextIdRef.current++
    return new Promise<Float32Array>((resolve, reject) => {
      pendingRef.current.set(id, { resolve, reject })
      worker.postMessage({ type: 'embed', id, bitmap } satisfies ToEmbedWorker, [
        bitmap,
      ])
    })
  }, [])

  return {
    ready: loadState.phase === 'ready',
    failed: loadState.phase === 'failed',
    failureMessage: loadState.failureMessage,
    embed,
  }
}
