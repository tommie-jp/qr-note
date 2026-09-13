// route handler が外から受け取る本文を読む (docs/93-リファクタリング計画.md §3-3)。
//
// 「読めなければ 400 の封筒」までを 1 か所に置く。口ごとに try/catch と
// 文言を書き写すと、片方だけ 500 に落ちる口ができる。
//
// 戻り値は guard.ts の guardRequest と同じ流儀で、ok でなければ response を
// そのまま返す。

import type { NextResponse } from 'next/server'
import { apiFail, type ApiResponseOptions } from './respond'

export type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly response: NextResponse }

// 本文の形が違うときの文言。JSON で受ける口はどれもこれ 1 つで断る
export const BAD_REQUEST_MESSAGE = 'リクエストの形式が正しくありません'

// JSON ボディを受け取る。壊れていれば null。
//
// 外から来る値なので、まず「オブジェクトかどうか」まで確かめてから返す。
// JSON.parse は 'null' や '42' も通してしまう
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json()
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return null
    }
    return body as Record<string, unknown>
  } catch {
    return null
  }
}

// JSON ボディを読み、check で要る値を取り出す。
//
// check は形が違えば null を返す。JSON として読めないときも、オブジェクトで
// ないときも、check が null を返したときも、同じ 400 (BAD_REQUEST_MESSAGE) で断る
// — 外から見て「どこが違ったか」を撃ち分ける理由がない
export async function parseJsonBody<T>(
  request: Request,
  check: (body: Readonly<Record<string, unknown>>) => T | null,
): Promise<Parsed<T>> {
  const body = await readJsonObject(request)
  const value = body === null ? null : check(body)
  if (value === null) {
    return { ok: false, response: apiFail(BAD_REQUEST_MESSAGE, 400) }
  }
  return { ok: true, value }
}

export interface FormBodyFailure {
  // サーバログに残す前置き (原因の例外を後ろに付けて console.error する)
  readonly log: string
  // 400 の封筒に載せる文言。口ごとに言うべきことが違う (images は大きさの目安を添える)
  readonly message: string
}

// multipart / urlencoded の本文を FormData として読む。
//
// 読めないときは 400 を返すが、原因はログに残す。書き方の誤りだけでなく、
// 途中で切れた通信や境界を書き換えるプロキシもここへ来るため
export async function parseFormBody(
  request: Request,
  failure: FormBodyFailure,
  options: ApiResponseOptions = {},
): Promise<Parsed<FormData>> {
  try {
    return { ok: true, value: await request.formData() }
  } catch (error) {
    console.error(failure.log, error)
    return { ok: false, response: apiFail(failure.message, 400, options) }
  }
}
