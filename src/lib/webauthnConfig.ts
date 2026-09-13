// パスキーの検証に要る 2 つの値 (docs/29-パスキー計画.md §7)。
//
// **リクエストから組み立ててはいけない。** アプリは nginx の内側に居るので、
// 自分では http://0.0.0.0:3100 しか見えていない。同じ罠を login/route.ts で
// 踏んでおり、あのときは実測で `http://0.0.0.0:3100/...` の redirect が出た。
// ブラウザが居る場所 (https://qr.tommie.jp) はアプリからは分からない。
//
// 設定漏れは**パスキー機能ごと無効**に倒す (appEnv.ts と同じで、迷ったら
// 閉じる側へ)。Basic 認証は生きているので締め出しにはならない。

import 'server-only'
import { createHash } from 'node:crypto'
import { SITE_NAME } from './site'

export interface WebAuthnConfig {
  // rpID。https:// を除いたドメイン名。パスキーはこの値に紐づいて保存され、
  // 後から変えると登録済みのパスキーがすべて使えなくなる
  rpId: string
  // 検証時に突き合わせる origin。scheme とポートまで含めた完全一致
  origin: string
  // 認証ダイアログに出るサービス名
  rpName: string
}

export function webauthnConfig(): WebAuthnConfig | null {
  // `??` ではなく `||` で受ける。.env に `WEBAUTHN_RP_ID=` と書くと
  // undefined ではなく空文字が来るため (site.ts の qrBaseUrl と同じ理由)
  const rpId = process.env.WEBAUTHN_RP_ID || ''
  const rawOrigin = process.env.WEBAUTHN_ORIGIN || ''

  if (rpId === '' || rawOrigin === '') {
    logDisabled('WEBAUTHN_RP_ID と WEBAUTHN_ORIGIN の両方が要ります')
    return null
  }

  let parsed: URL
  try {
    parsed = new URL(rawOrigin)
  } catch {
    logDisabled(`WEBAUTHN_ORIGIN が URL として不正です: ${JSON.stringify(rawOrigin)}`)
    return null
  }

  // rpId と origin が食い違っていると登録も検証も必ず失敗する。しかも
  // ブラウザ側のエラーは理由を教えてくれないので、ここで先に落としておく
  if (!hostMatchesRpId(parsed.hostname, rpId)) {
    logDisabled(
      `WEBAUTHN_ORIGIN のホスト (${parsed.hostname}) が ` +
        `WEBAUTHN_RP_ID (${rpId}) と一致しません`,
    )
    return null
  }

  return {
    rpId,
    // origin の比較は文字列の完全一致で行われる。URL の origin を使うことで
    // 末尾スラッシュやパスが混ざっていても正規化される
    origin: parsed.origin,
    rpName: SITE_NAME,
  }
}

// パスキーが使える設定になっているか。画面が導線を出すかどうかの判断に使う。
export function isPasskeyEnabled(): boolean {
  return webauthnConfig() !== null
}

// 認証器から見た「アカウントの識別子」(user handle)。
//
// **利用者名から決まる固定値でなければならない。** 登録のたびに乱数だと、
// 認証器はそれを別々のアカウントとみなし、iCloud キーチェーンに同じ名前の
// 項目がいくつも並ぶ。利用者は 1 名 (docs/29 §11) なので 1 つに見せる。
//
// 生の名前をそのまま渡さないのは、user handle が認証器と (同期していれば)
// クラウドにも残る値だから。ハッシュにしておけば、そこから名前は読めない。
export function stableUserHandle(userName: string): Uint8Array<ArrayBuffer> {
  const digest = createHash('sha256').update(userName, 'utf8').digest()

  // Buffer から直に new Uint8Array(buf) とすると、型が
  // Uint8Array<ArrayBufferLike> (SharedArrayBuffer を含む) になり、
  // SimpleWebAuthn が要求する Uint8Array<ArrayBuffer> と噛み合わない。
  // 長さを指定して確保してから詰め替えると ArrayBuffer に確定する
  const handle = new Uint8Array(digest.byteLength)
  handle.set(digest)
  return handle
}

// rpID として使えるのは「origin のホストそのもの」か「その親ドメイン」。
//
// endsWith だけで見ないこと。'nottommie.jp'.endsWith('tommie.jp') は真になり、
// 別人のドメインを親と誤認する。必ず '.' 区切りで確かめる
function hostMatchesRpId(host: string, rpId: string): boolean {
  return host === rpId || host.endsWith(`.${rpId}`)
}

function logDisabled(reason: string): void {
  console.error(`パスキーを無効にします (${reason})。docs/29-パスキー計画.md §7`)
}
