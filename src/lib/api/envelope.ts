// API の封筒 ({ success, data, error }) をブラウザ側で開ける
// (docs/93-リファクタリング計画.md §3-1)。書き手は src/lib/route/respond.ts。
//
// 読み手ごとに「失敗をどう扱うか」は違う — パスキーとシークレットは日本語の
// 例外を投げて画面にそのまま出し、検索履歴は投げずに null で諦め、オフライン
// 同期は自前の文言を出す。そこでここは 3 段に分けて置く:
//
//   openEnvelope / envelopeData … 本文の解釈だけ (純粋。どの読み手も使える)
//   apiFetch / readEnvelope     … 通信の失敗と読めない応答を ApiError に翻訳する
//   fetchEnvelope               … 上の 2 つを続けて data を返す (投げる読み手用)

// サーバが断ったときの例外。**status を持たせるのが要点** —
// 「パスキーが 1 つも無い (404)」と「一時的な失敗」を呼ぶ側が区別できないと、
// 通信が切れただけでこの端末の実績まで捨ててしまう (auth/passkeyClient.ts)。
//
// message はサーバが日本語で書いたものをそのまま持つので、画面へ直接出せる。
// status 0 は通信そのものが届かなかったこと (apiFetch)。
export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export type OpenedEnvelope =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly error: string | null }

// HTTP の状態と本文から封筒を開ける。2xx かつ success === true のときだけ ok。
//
// 失敗のときの error は、サーバが文字列で書いていればそれ (空文字もそのまま)、
// 無ければ null。空文字を既定の文言に落とすかどうかは読み手が決める
export function openEnvelope(status: number, body: unknown): OpenedEnvelope {
  const envelope = asRecord(body)
  if (status < 200 || status >= 300 || envelope?.success !== true) {
    return { ok: false, error: typeof envelope?.error === 'string' ? envelope.error : null }
  }
  return { ok: true, data: envelope.data }
}

// 本文から data だけを取り出す。成否 (success) は見ない — HTTP の状態で先に
// 分けてある読み手 (検索履歴・オフライン同期) 用。
// **サーバを無条件には信じない**: オブジェクトでなければ null
export function envelopeData(body: unknown): unknown {
  return asRecord(body)?.data ?? null
}

export const NETWORK_ERROR_MESSAGE = '通信に失敗しました。電波の状態を確認してください'

// fetch して、通信そのものの失敗だけを ApiError (status 0) に翻訳する。
// 原因 (TypeError など) はログに残す — 画面には出せない英語なので文言は差し替える
export async function apiFetch(path: string, init: RequestInit): Promise<Response> {
  try {
    // Cookie を送受りする口なので明示する (同一オリジンの既定ではあるが、
    // パスキーのログインは Set-Cookie を受け取る側なので意図を残す)
    return await fetch(path, { ...init, credentials: 'same-origin' })
  } catch (error) {
    console.error(`${path} への通信に失敗しました`, error)
    throw new ApiError(NETWORK_ERROR_MESSAGE, 0)
  }
}

// 応答を封筒として開けて data だけ返す。断られた・読めないときは ApiError。
// エラーはサーバが日本語で書いてくれているので、そのまま投げる
export async function readEnvelope(response: Response): Promise<unknown> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    // 502 の HTML が返ってきた場合など。JSON でないものを黙って無視しない
    throw new ApiError(
      `サーバから予期しない応答が返りました (${response.status})`,
      response.status,
    )
  }

  const opened = openEnvelope(response.status, body)
  if (!opened.ok) {
    throw new ApiError(opened.error || `処理に失敗しました (${response.status})`, response.status)
  }
  return opened.data
}

// 口を叩いて data を返す。型は呼ぶ側の申告 (サーバの応答は検算していない)
export async function fetchEnvelope<T = unknown>(path: string, init: RequestInit): Promise<T> {
  return (await readEnvelope(await apiFetch(path, init))) as T
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null
    ? (value as Readonly<Record<string, unknown>>)
    : null
}
