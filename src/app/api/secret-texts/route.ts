import type { NextResponse } from 'next/server'
import { toItemDto } from '@/lib/api/itemDto'
import { bytesToBase64 } from '@/lib/bytesBase64'
import { parseJsonBody } from '@/lib/route/parse'
import { apiFail, apiOk } from '@/lib/route/respond'
import { guardSecretRequest } from '@/lib/secret/route'
import { SECRET_BATCH_MAX_BYTES, SECRET_BATCH_MAX_NAMES } from '@/lib/secret/search'
import { isValidSecretName } from '@/lib/secret/secrets'
import { findSecretTextBlobs, listSecretTexts, secretTextBytes } from '@/lib/secret/textIndex'

// シークレット内検索の材料を配る口 (docs/130-シークレット内検索計画.md §5-1)。
//
//   GET  … 参照元のあるテキスト断片の一覧 (名前・暗号文のハッシュ・大きさ・参照元ノート) と、
//          シークレットを含むノート (全件。一致を一覧の行として描く材料。docs/131)
//   POST … 名前で指したテキスト断片の暗号文をまとめて返す
//
// **どちらも検索語を受け取らない。** 端末は一覧と暗号文を取って手元で復号・照合
// するので、何を探したかも、どれが一致したかもここには届かない。配るのは
// 暗号文だけで、鍵はサーバに無い (docs/51 §6)。
//
// 門番は断片の口と同じ (デモ拒否 → ログイン → クロスサイト拒否)。封筒は既定で
// no-store なので、暗号文も一覧も中間に残らない。
//
// **/api/secrets/ の下には置かない。** Service Worker (public/sw.js) がその下の
// GET を「棚が先」で返すので、一覧を置くと最初に取った一覧が返り続け、断片を
// 足しても編集しても検索に反映されなくなる (鍵束の口が例外にされているのと
// 同じ理由)。別の接頭辞にしておけば、古い版の Service Worker が動いている
// 配布直後の窓でも素通しになる。

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await guardSecretRequest(request)
  if (!guard.ok) {
    return guard.response
  }
  const { entries, items } = await listSecretTexts()
  return apiOk({ entries, items: items.map(toItemDto) })
}

// 名前の配列を取り出す。UUID の書式・件数・重複を見る (形が違えば null)
function namesOf(body: Readonly<Record<string, unknown>>): string[] | null {
  const { names } = body
  if (!Array.isArray(names) || names.length === 0 || names.length > SECRET_BATCH_MAX_NAMES) {
    return null
  }
  if (!names.every((name): name is string => typeof name === 'string' && isValidSecretName(name))) {
    return null
  }
  return new Set(names).size === names.length ? names : null
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await guardSecretRequest(request)
  if (!guard.ok) {
    return guard.response
  }

  const names = await parseJsonBody(request, namesOf)
  if (!names.ok) {
    return names.response
  }

  // 暗号文をメモリへ読む前に合計を確かめる。1 件だけなら大きくても通す —
  // 通さないと、上限より大きい断片を取る手段が無くなる (端末は 1 件で束にする)
  if (
    names.value.length > 1 &&
    (await secretTextBytes(names.value)) > SECRET_BATCH_MAX_BYTES
  ) {
    return apiFail('一度に取れる大きさを超えています', 413)
  }

  const blobs = await findSecretTextBlobs(names.value)
  return apiOk({
    blobs: blobs.map((blob) => ({ name: blob.name, data: bytesToBase64(blob.data) })),
  })
}
