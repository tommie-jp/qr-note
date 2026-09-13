import { NextResponse } from 'next/server'
import { byteHeaders, bytesResponse } from '@/lib/route/bytes'
import { apiFail, apiOk } from '@/lib/route/respond'
import { SECRET_MIME_HEADER } from '@/lib/secretPayload'
import { guardSecretRequest, readSecretBody } from '@/lib/secretRoute'
import { findSecret, saveSecret } from '@/lib/secretStore'
import { isValidSecretName } from '@/lib/secrets'

interface RouteContext {
  params: Promise<{ name: string }>
}

// 暗号文とはいえ**キャッシュに残さない** (docs/51-部分暗号化計画.md §10)。
// 画像の immutable キャッシュとは逆の選択で、これによって同名上書き
// (断片の編集) の結果が古い暗号文に化けることもない。
const NO_STORE = 'no-store'

// 断片の配信。**ログイン必須** — 公開ノート (publicAt) に参照が書かれていても、
// 未ログインの閲覧者には暗号文すら配らない (docs/51 §10)。
//
// publicPaths.ts の isSelfGuardedPath に /api/secrets/ を載せていないので
// proxy.ts が先に 401 で止めるが、そこを唯一の砦にはしない (route/guard.ts の作法)。
export async function GET(
  request: Request,
  { params }: RouteContext,
): Promise<NextResponse> {
  const guard = await guardSecretRequest(request)
  if (!guard.ok) {
    return guard.response
  }

  const { name } = await params
  if (!isValidSecretName(name)) {
    return apiFail('不正なシークレット名です', 400)
  }

  const secret = await findSecret(name)
  if (secret === null) {
    return apiFail('シークレットが見つかりません', 404)
  }

  return bytesResponse(
    secret.data,
    byteHeaders({
      // 中身は暗号文であって画像でも markdown でもない。復号後の種別は
      // 別ヘッダで伝え、ブラウザにはただのバイト列として渡す
      contentType: 'application/octet-stream',
      extra: { [SECRET_MIME_HEADER]: secret.mime },
      cacheControl: NO_STORE,
    }),
  )
}

// 断片の保存 (新規も編集も同じ口)。
//
// **名前はクライアントが決める**。エンベロープの AAD が名前に縛られている以上、
// 封をする時点で名前が要るため (secretStore.ts の saveSecret に経緯)。
// 受け付けるのは UUID の書式だけなので、トラバーサルの余地は無い。
export async function PUT(
  request: Request,
  { params }: RouteContext,
): Promise<NextResponse> {
  const guard = await guardSecretRequest(request)
  if (!guard.ok) {
    return guard.response
  }

  const { name } = await params
  if (!isValidSecretName(name)) {
    return apiFail('不正なシークレット名です', 400)
  }

  const body = await readSecretBody(request)
  if (body instanceof NextResponse) {
    return body
  }

  await saveSecret(name, body.mime, body.bytes)

  return apiOk({ name })
}
