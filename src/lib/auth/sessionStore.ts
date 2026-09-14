// セッション行の読み書き (docs/29-パスキー計画.md §4)。
//
// 生のトークンはブラウザの Cookie にしかない。ここが扱うのは常に
// sha256 したほうで、DB にも決してトークンそのものを渡さない。
//
// トークンの作り方と寿命の計算は auth/sessionToken.ts (純粋な層)。
// リクエストとの結びつけは auth/requestAuth.ts。

import 'server-only'
import { prisma } from '../db'
import {
  createSessionToken,
  hashSessionToken,
  sessionExpiresAt,
} from './sessionToken'

export interface IssuedSession {
  // ブラウザへ渡す生のトークン。**保存してはいけない**
  token: string
  expiresAt: Date
}

export interface ActiveSession {
  userName: string
  expiresAt: Date
}

// ログイン成功時に呼ぶ。生のトークンを返し、DB にはハッシュだけを残す。
export async function issueSession(
  userName: string,
  now: Date = new Date(),
): Promise<IssuedSession> {
  const token = createSessionToken()
  const expiresAt = sessionExpiresAt(now)

  await prisma.session.create({
    data: { tokenHash: hashSessionToken(token), userName, expiresAt },
  })

  // ログインは滅多に起きないので、期限切れの掃除をここに相乗りさせる。
  // cron を足さずに済み、行が無限に溜まることもない。
  // 掃除が失敗してもログインは成功させる (溜まるだけで害がない)
  try {
    await deleteExpiredSessions(now)
  } catch (error) {
    console.error('期限切れセッションの掃除に失敗しました', error)
  }

  return { token, expiresAt }
}

// トークンから利用者を引く。期限切れならその行を消して null を返す。
export async function findActiveSession(
  token: string | null,
  now: Date = new Date(),
): Promise<ActiveSession | null> {
  if (token === null || token.length === 0) {
    return null
  }

  const tokenHash = hashSessionToken(token)
  const row = await prisma.session.findUnique({ where: { tokenHash } })
  if (row === null) {
    return null
  }

  if (row.expiresAt <= now) {
    // 期限切れに出会ったその場で消す。掃除を issueSession だけに任せると、
    // ログインしないまま放置された行が残り続ける
    await prisma.session.delete({ where: { tokenHash } }).catch(() => {
      // 同時に消えていても構わない (目的は達成されている)
    })
    return null
  }

  return { userName: row.userName, expiresAt: row.expiresAt }
}

// 期限を延ばす。呼ぶ頃合いの判定は shouldRenewSession() (auth/sessionToken.ts)。
// 延ばした後の期限を返す。
export async function renewSession(
  token: string,
  now: Date = new Date(),
): Promise<Date> {
  const expiresAt = sessionExpiresAt(now)
  await prisma.session.update({
    where: { tokenHash: hashSessionToken(token) },
    data: { expiresAt },
  })
  return expiresAt
}

// ログアウト。無い行を消そうとしても静かに済ませる
// (二重ログアウトや、既に掃除された行で 500 にしない)。
export async function destroySession(token: string | null): Promise<void> {
  if (token === null || token.length === 0) {
    return
  }
  await prisma.session
    .delete({ where: { tokenHash: hashSessionToken(token) } })
    .catch(() => {
      // 消えていればそれでよい
    })
}

export async function deleteExpiredSessions(now: Date = new Date()): Promise<number> {
  const { count } = await prisma.session.deleteMany({
    where: { expiresAt: { lte: now } },
  })
  return count
}
