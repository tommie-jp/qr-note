// サーバ経由のクリップボードの、ブラウザ側の送受信
// (docs/114-サーバクリップボード計画.md §3)。**クライアント専用**。
//
// 画面 (components/clipboard/) からは、この module の関数を呼ぶだけにする。
// ブラウザの口 (navigator.clipboard・fetch・canvas) は deps で差し替えられる形にして
// あり、「read() を同期部で呼ぶ」のような罠をテストで押さえられる (jsdom が無いので
// 部品の中のイベント処理は確かめられない)。
//
// **read() と writeText() は、呼び出しの同期部で呼ぶ。** 先に await を挟むと iOS が
// ユーザー操作の外と見なして NotAllowedError で弾く (docs/92 §8、
// clipboard/shareFile.ts の transient activation と同じ話)。async 関数でも最初の
// await までは同期で走るので、下の 2 関数は最初の文でそれを呼ぶ。

import { errorText } from '../errorMessage'
import { MAX_IMAGE_BYTES } from '../uploads/limits'
import { copyImageToClipboard } from './clipboardImage'
import {
  type ClipboardEntry,
  clipboardFileName,
  clipboardReadErrorMessage,
  pickClipboardEntry,
} from './clipboardRead'
import { type ClipboardSlotMeta, parseSlotMeta } from './slot'
import { canShrink, shrinkImageFile } from '../images/shrinkImage'

const CLIPBOARD_URL = '/api/clipboard'
export const SERVER_CLIPBOARD_DATA_URL = '/api/clipboard/data'

// 文字は小さいので短く、画像は回線が細い (iPhone のモバイル回線) ことがあるので長く。
// 返らないままメニューの「送っています…」が残り続けるのを避ける
const TEXT_TIMEOUT_MS = 10_000
const IMAGE_TIMEOUT_MS = 60_000

export interface ServerClipboardDeps {
  // navigator.clipboard のうち使う部分。無い環境があるので全部 optional
  readonly clipboard: {
    read?: () => Promise<readonly ClipboardEntry[]>
    writeText?: (text: string) => Promise<void>
  }
  readonly fetchFn: typeof fetch
  readonly shrink: (file: File) => Promise<File>
  // 画像を PNG に描き直してクリップボードへ載せる (clipboard/clipboardImage.ts)
  readonly copyImage: (src: string) => Promise<void>
}

// 既定は実ブラウザ。呼ぶ時点で組む (モジュールの読み込み時に navigator を触ると
// サーバ描画で落ちる)
export function browserDeps(): ServerClipboardDeps {
  return {
    clipboard: navigator.clipboard as unknown as ServerClipboardDeps['clipboard'],
    fetchFn: (input, init) => fetch(input, init),
    shrink: shrinkImageFile,
    copyImage: copyImageToClipboard,
  }
}

// OS のクリップボードの中身 (画像を優先、無ければ文字) をサーバの枠へ置く
export async function sendClipboardToServer(
  deps: ServerClipboardDeps = browserDeps(),
): Promise<ClipboardSlotMeta> {
  const { clipboard } = deps
  if (typeof clipboard.read !== 'function') {
    throw new Error('この環境ではクリップボードを読めません')
  }
  // 同期部。ここより前に await を置かないこと
  const reading = clipboard.read()

  const pick = pickClipboardEntry(await reading)
  if (pick === null) {
    throw new Error('クリップボードに画像も文字もありません')
  }
  const blob = await pick.entry.getType(pick.type)

  if (pick.kind === 'text') {
    const text = await blob.text()
    if (text === '') {
      // 空の文字を置くと「枠を空にする」と読めてしまう。空にするのは「消す」の役目
      throw new Error('クリップボードの文字が空です')
    }
    return putSlot(deps, CLIPBOARD_URL, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      timeoutMs: TEXT_TIMEOUT_MS,
    })
  }

  const image = await fitForUpload(blob, pick.type, deps)
  return putSlot(deps, SERVER_CLIPBOARD_DATA_URL, {
    headers: { 'Content-Type': image.type || pick.type },
    body: image,
    timeoutMs: IMAGE_TIMEOUT_MS,
  })
}

// 上限を超える画像だけ縮める (iOS の写真は PNG で 20〜30MB になる)。上限以下は
// 触らない (再圧縮で劣化させない)。縮められない形式 (GIF) はそのまま送り、
// サーバの「大きすぎます」で断ってもらう — 動くものを黙って止めるよりよい
async function fitForUpload(blob: Blob, type: string, deps: ServerClipboardDeps): Promise<Blob> {
  if (blob.size <= MAX_IMAGE_BYTES) {
    return blob
  }
  const file = new File([blob], clipboardFileName(type), { type })
  return canShrink(file) ? deps.shrink(file) : blob
}

// サーバの枠の中身を OS のクリップボードへ載せる
export async function receiveFromServer(
  meta: ClipboardSlotMeta,
  deps: ServerClipboardDeps = browserDeps(),
): Promise<void> {
  if (meta.kind === 'image') {
    // 取得と PNG への描き直しは ClipboardItem の中で待たせる (copyImage が同期部で
    // 器を作る)。ここで先に fetch して待つと Safari が弾く
    await deps.copyImage(SERVER_CLIPBOARD_DATA_URL)
    return
  }
  const { clipboard } = deps
  if (typeof clipboard.writeText !== 'function') {
    throw new Error('この環境ではクリップボードに書けません')
  }
  // 文字は meta に同梱されているので、押した瞬間に同期で書ける
  await clipboard.writeText(meta.text ?? '')
}

// 枠のメタ。無ければ null (期限切れもサーバが消して null にする)
export async function fetchServerSlot(
  deps: ServerClipboardDeps = browserDeps(),
): Promise<ClipboardSlotMeta | null> {
  const response = await deps.fetchFn(CLIPBOARD_URL, {
    signal: AbortSignal.timeout(TEXT_TIMEOUT_MS),
  })
  return slotOf(await readEnvelope(response))
}

export async function clearServerSlot(deps: ServerClipboardDeps = browserDeps()): Promise<void> {
  const response = await deps.fetchFn(CLIPBOARD_URL, {
    method: 'DELETE',
    signal: AbortSignal.timeout(TEXT_TIMEOUT_MS),
  })
  await readEnvelope(response)
}

// 失敗を画面に出す文にする。NotAllowedError は DOMException の素の英文でなく、
// 何が許可されなかったかを方向ごとに言う (iOS ではペーストの吹き出しを
// 閉じただけでも送る側のここに来る)
export function serverClipboardErrorMessage(
  error: unknown,
  direction: 'send' | 'receive',
): string {
  if (direction === 'send') {
    return clipboardReadErrorMessage(error)
  }
  if ((error as { name?: string } | null)?.name === 'NotAllowedError') {
    return 'クリップボードへの書き込みが許可されませんでした'
  }
  return errorText(error)
}

async function putSlot(
  deps: ServerClipboardDeps,
  url: string,
  { headers, body, timeoutMs }: { headers: Record<string, string>; body: BodyInit; timeoutMs: number },
): Promise<ClipboardSlotMeta> {
  const response = await deps.fetchFn(url, {
    method: 'PUT',
    headers,
    body,
    signal: AbortSignal.timeout(timeoutMs),
  })
  const meta = slotOf(await readEnvelope(response))
  if (meta === null) {
    throw new Error('サーバの応答を読めませんでした')
  }
  return meta
}

function slotOf(data: unknown): ClipboardSlotMeta | null {
  const slot = (data as { slot?: unknown } | null)?.slot
  return parseSlotMeta(slot)
}

// 封筒 ({ success, data, error }) を開ける。サーバが断った理由はそのまま画面に出す
// (「文字が大きすぎます (最大 64KB)」など、利用者が次に何をすればよいか分かる文言)。
// 封筒でない応答 (proxy や nginx の HTML) は状態コードだけで説明する
async function readEnvelope(response: Response): Promise<unknown> {
  const body = await readJsonOrNull(response)
  if (response.ok && body?.success === true) {
    return body.data
  }
  if (typeof body?.error === 'string') {
    throw new Error(body.error)
  }
  throw new Error(`サーバが応答しませんでした (${response.status})`)
}

interface Envelope {
  readonly success?: unknown
  readonly data?: unknown
  readonly error?: unknown
}

async function readJsonOrNull(response: Response): Promise<Envelope | null> {
  try {
    const body: unknown = await response.json()
    return typeof body === 'object' ? (body as Envelope | null) : null
  } catch {
    return null
  }
}
