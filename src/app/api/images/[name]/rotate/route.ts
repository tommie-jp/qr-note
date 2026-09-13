import type { NextResponse } from 'next/server'
import { checkDemoUploadQuota } from '@/lib/demoQuota'
import { saveImage } from '@/lib/imageStore'
import { rewriteImageReference } from '@/lib/items'
import { guardRequest } from '@/lib/route/guard'
import { apiFail, apiOk, WITHOUT_CACHE_CONTROL } from '@/lib/route/respond'
import {
  isRotatableExt,
  isRotateAngle,
  rotateImageBytes,
} from '@/lib/rotateImage'
import { prisma } from '@/lib/db'
import { isValidImageName } from '@/lib/uploads'

interface RouteContext {
  params: Promise<{ name: string }>
}

// 挿入済み画像を 90° 単位で回す (docs/49-画像回転計画.md)。
//
// 同名上書きは immutable キャッシュに阻まれるため、回転済みバイト列を**新 UUID で
// 保存し直し**、その名前を参照する本文をすべて書き換える。旧画像行は消さない
// (画像 GC が回収する。docs/49 §1)。body は `{ angle: 90 | 180 | 270 }`。
export async function POST(
  request: Request,
  { params }: RouteContext,
): Promise<NextResponse> {
  // ログイン + CSRF。データに触る前に断る (uploads.ts と同じ流儀・順)
  const guard = await guardRequest(request, { demo: 'allow' })
  if (!guard.ok) {
    return guard.response
  }

  const { name } = await params

  // 名前の検算が先。この後 DB へ渡す値なので書式を確かめる (route.ts と同じ線引き)
  if (!isValidImageName(name)) {
    return apiFail('不正なファイル名です', 400, WITHOUT_CACHE_CONTROL)
  }

  // gif は回さない — アニメ GIF のフレーム保持が sharp 既定では効かず、
  // 静止画に潰れてしまうため。動画・音声・PDF は isValidImageName で既に外れる
  const ext = name.split('.').pop() ?? ''
  if (!isRotatableExt(ext)) {
    return apiFail('この形式は回転できません', 400, WITHOUT_CACHE_CONTROL)
  }

  let angle: unknown
  try {
    angle = (await request.json())?.angle
  } catch {
    return apiFail('JSON の body を送信して下さい', 400, WITHOUT_CACHE_CONTROL)
  }
  if (!isRotateAngle(angle)) {
    return apiFail('angle は 90 / 180 / 270 のいずれかです', 400, WITHOUT_CACHE_CONTROL)
  }

  const image = await prisma.image.findUnique({
    where: { name },
    select: { data: true, mime: true },
  })
  if (!image) {
    return apiFail('画像が見つかりません', 404, WITHOUT_CACHE_CONTROL)
  }

  // デモの総量クォータ (docs/39 §2-1)。回転は 1 枚ぶん実データが増えるので、
  // アップロードと同じく保存前に総量を見る。**回す前に**見るのは、超過が確実な
  // 相手に高価な sharp の再符号化を走らせないため — 90° 回転で実データの大きさは
  // ほぼ変わらないので、原寸のバイト数で見積もって十分 (クォータは元より近似)。
  const quota = await checkDemoUploadQuota(image.data.byteLength)
  if (quota) {
    return apiFail(quota.error, quota.status, WITHOUT_CACHE_CONTROL)
  }

  // 回転 + 再符号化。壊れた画像・符号化失敗は 500 ではなく 400 で断る
  // (thumbnail.ts / normalizeImage.ts と同じ「壊れた入力は握らずログ」の流儀)
  let rotated: Uint8Array<ArrayBuffer>
  try {
    rotated = await rotateImageBytes(
      image.data as Uint8Array<ArrayBuffer>,
      ext,
      angle,
    )
  } catch (error) {
    console.error(`画像の回転に失敗しました (${name}, ${angle}°):`, error)
    return apiFail('画像を回転できませんでした', 400, WITHOUT_CACHE_CONTROL)
  }

  // 新 UUID で保存し直す (thumb + embedding も自動再生成)。mime は保存済みの
  // 正本 (images.mime) をそのまま使う — 再符号化で ext は保たれるので形式も同じ
  const newUrl = await saveImage(rotated, image.mime, ext)
  const newName = newUrl.slice(newUrl.lastIndexOf('/') + 1)

  // この画像を参照する本文をすべて新 URL へ追随させる (ゴミ箱内も含む)
  await rewriteImageReference(name, newName)

  return apiOk({ url: newUrl }, 200, WITHOUT_CACHE_CONTROL)
}
