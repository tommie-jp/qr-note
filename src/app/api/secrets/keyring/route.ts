import { NextResponse } from 'next/server'
import { readJsonObject } from '@/lib/authApi'
import { base64ToBytes, bytesToBase64 } from '@/lib/bytesBase64'
import { denySecretRequest, secretFail } from '@/lib/secretRoute'
import {
  deleteKeyring,
  findKeyringVerifier,
  hasCredential,
  initKeyring,
  listKeyWraps,
  saveKeyWrap,
} from '@/lib/secretStore'

// 鍵束の口 (docs/51-部分暗号化計画.md §6)。
//
// ここを流れるのは**包んだ後の鍵と検証値だけ**。マスターキーの平文は
// クライアントのメモリにしか存在せず、この口には現れない。
//
//   GET  … 設定済みか / 各パスキーの包み (解錠に使う)
//   POST … 初回設定 (検証値 + 最初の包み)
//   PUT  … 2 台目以降の包みを足す

// 鍵の材料はどれも数十バイト。これを超えるものは形式違い (溜め込まない)
const MAX_KEY_BYTES = 256

export async function GET(request: Request): Promise<NextResponse> {
  const denied = await denySecretRequest(request)
  if (denied) {
    return denied
  }

  const verifier = await findKeyringVerifier()
  const wraps = await listKeyWraps()

  return keyringOk({
    initialized: verifier !== null,
    verifier: verifier === null ? null : bytesToBase64(verifier),
    // 包んだ後のバイト列なので、ログイン済みの相手にまとめて返してよい
    // (開けるのは認証器を持つ本人だけ)。画面はこの一覧を見て
    // 「この端末で有効にする」と「解錠」を出し分ける
    wraps: wraps.map((wrap) => ({
      credentialId: wrap.credentialId,
      label: wrap.label,
      wrapped: wrap.wrapped === null ? null : bytesToBase64(wrap.wrapped),
    })),
  })
}

// 初回設定。**既に設定済みなら断る** — 検証値を上書きすると、既存の断片を
// 開けるマスターキーが分からなくなる (二重に設定できてはいけない)。
export async function POST(request: Request): Promise<NextResponse> {
  const denied = await denySecretRequest(request)
  if (denied) {
    return denied
  }

  const body = await readJsonObject(request)
  const verifier = readKeyBytes(body?.verifier)
  const wrap = readWrapFields(body)
  if (verifier === null || wrap === null) {
    return secretFail(400, 'リクエストの形式が正しくありません')
  }

  // **パスキーの存在確認が先**。逆順にすると、知らないパスキーで設定を試みた
  // ときに「鍵束はあるが、それを開ける包みが 1 つも無い」状態が残る。復旧キーは
  // まだ画面に出ていないので誰にも開けられず、しかも初回設定は 409 で断られる
  // ため作り直せない (secretStore.ts の hasCredential に経緯)
  if (!(await hasCredential(wrap.credentialId))) {
    return secretFail(404, 'そのパスキーは登録されていません')
  }

  if (!(await initKeyring(verifier))) {
    return secretFail(409, '暗号化は既に設定されています')
  }

  // 存在確認と書き込みの間にパスキーが消える競合はありうる (別タブでの削除)。
  // **鍵束だけ残さない** — 包みが 1 つも無い鍵束は誰にも開けられないうえ、
  // 作り直そうとしても 409 で断られる行き止まりになる。畳んでやり直させる
  if (!(await saveKeyWrap(wrap.credentialId, wrap.wrapped))) {
    await deleteKeyring()
    return secretFail(404, 'そのパスキーは登録されていません')
  }

  return keyringOk({ initialized: true })
}

// 2 台目以降 (または作り直し) の包みを足す。
export async function PUT(request: Request): Promise<NextResponse> {
  const denied = await denySecretRequest(request)
  if (denied) {
    return denied
  }

  const body = await readJsonObject(request)
  const wrap = readWrapFields(body)
  if (wrap === null) {
    return secretFail(400, 'リクエストの形式が正しくありません')
  }

  // 鍵束が無いのに包みだけ足せると、検証値と噛み合わない鍵が入りうる
  if ((await findKeyringVerifier()) === null) {
    return secretFail(409, '先に暗号化を設定してください')
  }

  if (!(await saveKeyWrap(wrap.credentialId, wrap.wrapped))) {
    return secretFail(404, 'そのパスキーは登録されていません')
  }

  return keyringOk({ initialized: true })
}

function keyringOk<T>(data: T): NextResponse {
  return NextResponse.json(
    { success: true, data, error: null },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

// base64 の鍵材料を読む。形式違い・長すぎるものは null。
function readKeyBytes(value: unknown): Uint8Array<ArrayBuffer> | null {
  if (typeof value !== 'string' || value === '') {
    return null
  }
  const bytes = base64ToBytes(value)
  if (bytes === null || bytes.byteLength === 0 || bytes.byteLength > MAX_KEY_BYTES) {
    return null
  }
  return bytes
}

function readWrapFields(
  body: Record<string, unknown> | null,
): { credentialId: string; wrapped: Uint8Array<ArrayBuffer> } | null {
  const credentialId = body?.credentialId
  const wrapped = readKeyBytes(body?.wrapped)
  if (typeof credentialId !== 'string' || credentialId === '' || wrapped === null) {
    return null
  }
  return { credentialId, wrapped }
}
