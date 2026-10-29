// 端末から JSON API を呼ぶ唯一の入口 (docs/123 §3-1)。
//
// 封筒 ({ success, data, error, meta? }) を剥がし、失敗は ApiError で投げる。
// 呼ぶ側は「届いた data の形」を自分の型述語で検めてから使う (外から来た値を
// 信用しない)。ここは封筒の形までしか見ない。
//
// 401 (セッション切れ) は画面ごと読み直す。画面の GET は proxy.ts が未ログインを
// ログインの案内へ差し替えるので、読み直せば案内が出る。ここで案内の URL を
// 組み立てない — 案内の出し方は proxy が 1 か所で持っている
import 'client-only'

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export interface ApiEnvelope<T> {
  data: T
  meta: unknown
}

// 401 を受けたときの振る舞い。テストで差し替えられるよう外に出す
let onUnauthorized: () => void = () => {
  window.location.reload()
}

export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler
}

const NETWORK_MESSAGE = '通信できませんでした。電波の届く所でもう一度お試しください'

async function readEnvelope<T>(response: Response): Promise<ApiEnvelope<T>> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ApiError(response.status, `応答を読めませんでした (${response.status})`)
  }
  if (typeof body !== 'object' || body === null) {
    throw new ApiError(response.status, `応答の形が違います (${response.status})`)
  }
  const envelope = body as Record<string, unknown>
  if (envelope.success !== true) {
    const message =
      typeof envelope.error === 'string' && envelope.error !== ''
        ? envelope.error
        : `失敗しました (${response.status})`
    throw new ApiError(response.status, message)
  }
  return { data: envelope.data as T, meta: envelope.meta }
}

async function send<T>(input: string, init: RequestInit): Promise<ApiEnvelope<T>> {
  let response: Response
  try {
    response = await fetch(input, { credentials: 'same-origin', ...init })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error
    }
    throw new ApiError(0, NETWORK_MESSAGE)
  }
  if (response.status === 401) {
    onUnauthorized()
    throw new ApiError(401, 'ログインが必要です')
  }
  return readEnvelope<T>(response)
}

export function apiGet<T>(path: string, signal?: AbortSignal): Promise<ApiEnvelope<T>> {
  return send<T>(path, { method: 'GET', signal, cache: 'no-store' })
}

export function apiSend<T>(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<ApiEnvelope<T>> {
  return send<T>(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
