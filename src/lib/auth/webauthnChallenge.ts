// 発行済みチャレンジの検証 (docs/29-パスキー計画.md §5, §9)。
//
// チャレンジは「サーバが出した乱数に、認証器が署名して返す」ための使い捨ての値。
// これがないと、一度盗んだ署名を何度でも使い回せる (リプレイ)。
//
// **2026-11 の監査 (LOW) で、覚える方式から署名する方式に替えた。** 以前は発行した
// チャレンジを Map に 64 個まで覚え、溢れたら古い順に捨てていた。未ログインで
// login-options を 64 回叩くだけで、正規の人が Face ID を出している最中の
// チャレンジを押し出せた (1 IP でも約 2 分。可用性だけの穴)。
//
// いまはチャレンジ自体に「いつまで有効か」と HMAC の署名を入れる:
//
//   <乱数 16B の base64url>.<期限 epoch ms>.<HMAC-SHA256 の base64url>
//
// 検証は署名と期限を見るだけなので、何個発行されていても他人の分は押し出されない。
// 覚えるのは**使い終わった**チャレンジだけ (リプレイを止めるため)。これも
// 期限が来れば要らなくなるので、期限で掃き、上限 (CHALLENGE_USED_MAX) で縛る。
// 上限に当たるのは 5 分の間に数千回ログインに成功したときで、nginx の枠
// (30r/m) の下では起きない。
//
// 鍵はプロセスの起動時に作る乱数。再起動で変わるが、チャレンジの寿命は 5 分しか
// ないので「もう一度ボタンを押す」で済む (以前の Map も再起動で消えていた)。
// 単一プロセス前提 (複数台なら env から鍵を渡す形にする)。
//
// 利用者との紐づけは持たない。誰のものかは、署名を検証する公開鍵のほうが決める。

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

// 認証器の操作 (Face ID を出して指を置く) に要る時間から決めた。
// 長くすると盗んだチャレンジを使える窓が広がり、短くすると
// 「ダイアログを見て少し考えていたら失敗する」が起きる
export const CHALLENGE_TTL_MS = 5 * 60 * 1000

// 使い終わったチャレンジを覚える上限 (リプレイ防止)。期限が来た分は掃く
export const CHALLENGE_USED_MAX = 4096

const NONCE_BYTES = 16
const SIGNATURE_BYTES = 32

// プロセスごとの署名鍵。テストでは __resetChallengesForTest が作り直す
let signingKey = randomBytes(32)

// 使い終わったチャレンジ -> 期限 (epoch ms)。Map は挿入順を保つので、先頭 = 最も古い
const used = new Map<string, number>()

export function __resetChallengesForTest(): void {
  used.clear()
  signingKey = randomBytes(32)
}

export function countUsedChallenges(): number {
  return used.size
}

function sign(nonce: string, expiresAt: number): string {
  return createHmac('sha256', signingKey)
    .update(`${nonce}.${expiresAt}`)
    .digest('base64url')
}

// チャレンジを発行する。SimpleWebAuthn の generate*Options({ challenge }) に
// 文字列のまま渡す (あちらが UTF-8 のバイト列として扱い、クライアントには
// base64url で届く)。検証側 (consumeChallenge) はその base64url を受ける
export function issueChallenge(now: Date = new Date()): string {
  const nonce = randomBytes(NONCE_BYTES).toString('base64url')
  const expiresAt = now.getTime() + CHALLENGE_TTL_MS
  return `${nonce}.${expiresAt}.${sign(nonce, expiresAt)}`
}

// 認証器が返した challenge (clientDataJSON の値 = 発行した文字列の base64url) を
// 元の文字列に戻す。読めなければ null
function decodeChallenge(encoded: string): string | null {
  try {
    const text = Buffer.from(encoded, 'base64url').toString('utf8')
    // base64url で往復して同じになるものだけ (壊れた入力を通さない)
    return Buffer.from(text, 'utf8').toString('base64url') === encoded ? text : null
  } catch {
    return null
  }
}

// 署名と期限が正しいか (使用済みかは見ない)
function isGenuine(challenge: string, now: Date): boolean {
  const parts = challenge.split('.')
  if (parts.length !== 3) {
    return false
  }
  const [nonce, expiresText, signature] = parts
  const expiresAt = Number(expiresText)
  if (!/^\d+$/.test(expiresText) || !Number.isSafeInteger(expiresAt)) {
    return false
  }
  const expected = Buffer.from(sign(nonce, expiresAt), 'base64url')
  const actual = Buffer.from(signature, 'base64url')
  if (expected.byteLength !== SIGNATURE_BYTES || actual.byteLength !== SIGNATURE_BYTES) {
    return false
  }
  if (!timingSafeEqual(expected, actual)) {
    return false
  }
  return expiresAt > now.getTime()
}

// 使ってよいチャレンジかを答え、**成否によらず使用済みにする**。
//
// 失敗しても使用済みにするのが要点。残すと、署名を作り直しながら同じチャレンジへ
// 何度でも挑戦できてしまう。
//
// SimpleWebAuthn の expectedChallenge にそのまま渡せる形にしてある:
//   expectedChallenge: (challenge) => consumeChallenge(challenge)
export function consumeChallenge(encoded: string, now: Date = new Date()): boolean {
  const challenge = decodeChallenge(encoded)
  if (challenge === null) {
    return false
  }
  if (used.has(challenge)) {
    return false
  }
  const genuine = isGenuine(challenge, now)
  // 本物だけを覚える。偽物を覚えると、でたらめな値を送り続けるだけで
  // 覚える枠を埋められる
  if (genuine) {
    rememberUsed(challenge, now)
  }
  return genuine
}

function rememberUsed(challenge: string, now: Date): void {
  sweepExpired(now)
  if (used.size >= CHALLENGE_USED_MAX) {
    const oldest = used.keys().next().value
    if (oldest !== undefined) {
      used.delete(oldest)
    }
  }
  const expiresAt = Number(challenge.split('.')[1])
  used.set(challenge, expiresAt)
}

// 認証器の応答 (clientDataJSON) に入っているチャレンジを使用済みにする。
//
// **検証まで辿り着かずに断るときに要る。** login-verify は credential ID が
// 未知なら verifyAuthenticationResponse() を呼ばずに帰るが、それだけだと
// 上の consumeChallenge が一度も走らず、そのチャレンジが 5 分間生き残る。
// 「成否によらず消費する」を早期 return の経路でも守るためのもの。
//
// 読めない値なら何もしない (消すべきチャレンジを特定できないため)。
// clientDataJSON は素性の知れない入力なので、投げずに黙って諦める
export function consumeChallengeFromClientData(
  clientDataJSON: unknown,
  now: Date = new Date(),
): void {
  if (typeof clientDataJSON !== 'string') {
    return
  }

  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(clientDataJSON, 'base64url').toString('utf8'),
    )
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { challenge?: unknown }).challenge === 'string'
    ) {
      consumeChallenge((parsed as { challenge: string }).challenge, now)
    }
  } catch {
    // base64 でも JSON でもなかった。消すものが分からない以上、放っておく
    // (TTL と上限がいずれ片付ける)
  }
}

function sweepExpired(now: Date): void {
  const nowMs = now.getTime()
  for (const [challenge, expiresAt] of used) {
    if (expiresAt <= nowMs) {
      used.delete(challenge)
    }
  }
}
