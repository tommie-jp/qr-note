import type { NextResponse } from 'next/server'
import {
  MAX_CLIPBOARD_TEXT_BYTES,
  textByteLength,
} from '@/lib/clipboard/slot'
import { clearSlot, readSlotMeta, writeSlotText } from '@/lib/clipboard/slotStore'
import { guardRequest } from '@/lib/route/guard'
import { readBodyBounded } from '@/lib/route/boundedBody'
import { BAD_REQUEST_MESSAGE } from '@/lib/route/parse'
import { apiFail, apiOk } from '@/lib/route/respond'

// サーバ経由のクリップボードの文字の口 (docs/114-サーバクリップボード計画.md §2)。
// 画像の中身は /api/clipboard/data。メタ (種類・大きさ・時刻) はこちらで返す。
//
// **3 本ともデモでは閉じる。** デモは共有アカウントなので、1 枠が全員に見えてしまう。
// 導線 (メニューの行) も出さないが、口の側でも塞ぐ (api/settings/photo-meta と同じ)。
// 読み出し (GET) も閉じる — 他の人が置いた中身を読めること自体が漏れ

// JSON にすると、制御文字は 1 バイトが \uXXXX の 6 バイトに膨らむ。64KB の文字が
// 正当に最大で占める大きさ + 枠 ({"text":""}) の余裕。これを超える本文は読まない
const JSON_ESCAPE_FACTOR = 6
const JSON_ENVELOPE_SLACK_BYTES = 1024
const MAX_BODY_BYTES = MAX_CLIPBOARD_TEXT_BYTES * JSON_ESCAPE_FACTOR + JSON_ENVELOPE_SLACK_BYTES

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await guardRequest(request, { demo: 'deny' })
  if (!guard.ok) {
    return guard.response
  }

  // 期限切れはここで消えて null になる (slotStore)
  return apiOk({ slot: await readSlotMeta(guard.user) })
}

export async function PUT(request: Request): Promise<NextResponse> {
  const guard = await guardRequest(request, { demo: 'deny' })
  if (!guard.ok) {
    return guard.response
  }

  // **読みながら数える。** Content-Length の申告が無い送信 (chunked) や嘘の申告は
  // 事前に断れないので、超えた時点で読むのをやめる (route/boundedBody.ts)
  const bytes = await readBodyBounded(request, MAX_BODY_BYTES)
  if (bytes === null) {
    return tooLarge()
  }
  const text = textOf(bytes)
  // **知らない形は畳まず断る。** 空文字を「消す」と読み替えると、送り手は
  // 送れたと思い込む。消すのは DELETE の役目。
  // NUL は PostgreSQL の text に入らず、保存で例外 (500) になる
  if (text === null || text === '' || text.includes('\0')) {
    return apiFail(BAD_REQUEST_MESSAGE, 400)
  }
  if (textByteLength(text) > MAX_CLIPBOARD_TEXT_BYTES) {
    return tooLarge()
  }

  return apiOk({ slot: await writeSlotText(guard.user, text) })
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const guard = await guardRequest(request, { demo: 'deny' })
  if (!guard.ok) {
    return guard.response
  }

  await clearSlot(guard.user)
  return apiOk({ slot: null })
}

function tooLarge(): NextResponse {
  return apiFail(`文字が大きすぎます (最大 ${MAX_CLIPBOARD_TEXT_BYTES / 1024}KB)`, 413)
}

// {"text": "..."} から text を取り出す。JSON でない・オブジェクトでない・text が文字列でない
// ときは null
function textOf(bytes: Uint8Array): string | null {
  try {
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return null
    }
    const { text } = body as { text?: unknown }
    return typeof text === 'string' ? text : null
  } catch {
    return null
  }
}
