// 発行済みチャレンジの記憶 (docs/29-パスキー計画.md §5, §9)。
//
// チャレンジは「サーバが出した乱数に、認証器が署名して返す」ための使い捨ての値。
// これがないと、一度盗んだ署名を何度でも使い回せる (リプレイ)。
//
// DB には置かない。プロセス内の Map で足りる:
//
//   * 寿命が 5 分しかない。再起動で消えても「もう一度ボタンを押す」で済む
//   * 触るのは route handler だけなので、proxy が別バンドルになる問題を踏まない
//     (auth/basicAuth.ts の検証キャッシュが proxy と共有されないのと同じ事情。
//      あちらは両側で温まればよかったが、こちらは発行と検証が同じ側で完結する)
//
// 利用者との紐づけは持たない。チャレンジ自体が 256bit の乱数で、
// 当てずっぽうでは作れないため — 「我々が出したもののうち、まだ使われて
// いない 1 つ」であることが確認できれば目的は足りる。誰のものかは、
// 署名を検証する公開鍵のほうが決める。

// 認証器の操作 (Face ID を出して指を置く) に要る時間から決めた。
// 長くすると盗んだチャレンジを使える窓が広がり、短くすると
// 「ダイアログを見て少し考えていたら失敗する」が起きる
export const CHALLENGE_TTL_MS = 5 * 60 * 1000

// 同時に持てる数の上限。無いと、ログイン画面を叩き続けるだけで
// メモリを食い潰せる (auth/basicAuth.ts のキャッシュに上限を付けたのと同じ理由)
export const CHALLENGE_MAX = 64

// challenge -> 期限 (epoch ms)。Map は挿入順を保つので、先頭 = 最も古い
const pending = new Map<string, number>()

export function __resetChallengesForTest(): void {
  pending.clear()
}

export function countPendingChallenges(): number {
  return pending.size
}

// 発行したチャレンジを覚える。
export function rememberChallenge(challenge: string, now: Date = new Date()): void {
  // 先に期限切れを掃く。掃かないと、5 分前の死んだチャレンジが上限枠を
  // 占領し、いま出したばかりの生きたチャレンジを追い出してしまう
  sweepExpired(now)

  if (pending.size >= CHALLENGE_MAX) {
    const oldest = pending.keys().next().value
    if (oldest !== undefined) {
      pending.delete(oldest)
    }
  }

  pending.set(challenge, now.getTime() + CHALLENGE_TTL_MS)
}

// 使ってよいチャレンジかを答え、**成否によらず消費する**。
//
// 失敗しても消すのが要点。残すと、署名を作り直しながら同じチャレンジへ
// 何度でも挑戦できてしまう。
//
// SimpleWebAuthn の expectedChallenge にそのまま渡せる形にしてある:
//   expectedChallenge: (challenge) => consumeChallenge(challenge)
export function consumeChallenge(challenge: string, now: Date = new Date()): boolean {
  const expiresAt = pending.get(challenge)
  if (expiresAt === undefined) {
    return false
  }

  pending.delete(challenge)
  return expiresAt > now.getTime()
}

// 認証器の応答 (clientDataJSON) に入っているチャレンジを消費する。
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
  for (const [challenge, expiresAt] of pending) {
    if (expiresAt <= nowMs) {
      pending.delete(challenge)
    }
  }
}
