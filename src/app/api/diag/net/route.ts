import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { guardRequest } from '@/lib/route/guard'
import { apiFail, apiOk } from '@/lib/route/respond'

// 回線の計測の口 (docs/121-QR-Noteベンチマーク計画.md §4-1)。
//
// GET ?size=N … N バイトの乱数を返す (往復は size=0、下りは 2MB)
// POST       … 本文を読み切って捨て、受け取ったバイト数を返す (上り)
//
// 中身は**乱数の octet-stream**。テキストにすると gzip で縮んで数字が嘘になる。
// 乱数は 1 度だけ作って使い回す (毎回作るとその時間が下りに混ざる)。
// ログインは要る・デモは断る (他人の回線を測る口にしない)
export const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024
export const MAX_UPLOAD_BYTES = 1024 * 1024

const globalForNet = globalThis as unknown as { qrNoteNetPayload?: Buffer }

function payload(): Buffer {
  globalForNet.qrNoteNetPayload ??= randomBytes(MAX_DOWNLOAD_BYTES)
  return globalForNet.qrNoteNetPayload
}

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await guardRequest(request, { demo: 'deny' })
  if (!guard.ok) {
    return guard.response
  }
  const size = Number(new URL(request.url).searchParams.get('size') ?? '0')
  if (!Number.isInteger(size) || size < 0 || size > MAX_DOWNLOAD_BYTES) {
    return apiFail(`size は 0〜${MAX_DOWNLOAD_BYTES} の整数`, 400)
  }
  return new NextResponse(new Uint8Array(payload().subarray(0, size)), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(size),
      // 測るたびに回線を通す (端末にも経路にも溜めない)
      'Cache-Control': 'no-store',
    },
  })
}

// 本文を数えながら読み、上限を超えたら打ち切る (全部を溜めない)
async function countBody(request: Request, limit: number): Promise<number | null> {
  const reader = request.body?.getReader()
  if (reader === undefined) {
    return 0
  }
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      return total
    }
    total += value.byteLength
    if (total > limit) {
      await reader.cancel()
      return null
    }
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await guardRequest(request, { demo: 'deny' })
  if (!guard.ok) {
    return guard.response
  }
  const bytes = await countBody(request, MAX_UPLOAD_BYTES)
  if (bytes === null) {
    return apiFail(`上りの計測は ${MAX_UPLOAD_BYTES} バイトまで`, 413)
  }
  return apiOk({ bytes })
}
