import type { NextResponse } from 'next/server'
import { isPhotoMetaMode } from '@/lib/prefs/photoMeta'
import { savePhotoMetaMode } from '@/lib/prefs/photoMetaStore'
import { guardRequest } from '@/lib/route/guard'
import { parseJsonBody } from '@/lib/route/parse'
import { apiOk } from '@/lib/route/respond'

// 写真の撮影情報 (EXIF) を保存時に消すか残すかを保存する口
// (docs/113-写真の撮影情報削除計画.md §5)。形は選択色の口 (api/settings/row-tint) と同じ。
//
// PUT だけ。読み出しの口は要らない — 値はサーバが layout で読んでメニューへ降ろし、
// 写真を受ける口 (api/images・api/import) も自分で読む。
//
// **デモでは断る** (§2-5)。デモは共有アカウントなので、誰か 1 人が「残す」にすると
// 全員の写真に効く。導線 (メニューの行) も出さないが、口の側でも塞ぐ。
// 読む側 (loadPhotoMetaMode) もデモでは常に「消す」を返すので、ここを抜けても漏れない
export async function PUT(request: Request): Promise<NextResponse> {
  const guard = await guardRequest(request, { demo: 'deny' })
  if (!guard.ok) {
    return guard.response
  }

  // **知らない値は畳まず断る。** 既定 (消す) へ寄せると、送り手は「残す」に
  // できたと思い込んだまま消され続ける
  const mode = await parseJsonBody(request, (body) => {
    const { mode: value } = body
    return isPhotoMetaMode(value) ? value : null
  })
  if (!mode.ok) {
    return mode.response
  }

  await savePhotoMetaMode(guard.user, mode.value)
  return apiOk({ mode: mode.value })
}
