// 計測ログの取得鍵 (docs/120-計測テスト自動化計画.md §3)。
//
// 計測行 (docs/119) を、ログインせずに手元のスクリプト (scripts/fetchPerfLog.sh)
// から読むための鍵。/logs?perf=1 でログイン中の人が発行し、**その場で 1 度だけ**
// 見せる。保存するのは sha256 だけなので、DB を読まれても鍵は取り出せない。
// 発行し直すと前の鍵は使えなくなる (1 人 1 本)。
//
// 鍵で読めるのは計測行だけ。警告・エラーのログ、ノート、設定には届かない。
// 計測行に載るのは検索語の先頭 20 文字とノート id の頭までで、本文は載らない
// (docs/119 §1-5)。
//
// 鍵は 32 バイトの乱数 (base64url で 43 文字)。総当たりで当たる大きさではない
// ので、照合は hash の一致を DB に訊くだけにする。
import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { findUserSettingOwner, writeUserSetting } from '@/lib/prefs/userSettingStore'

export const PERF_EXPORT_TOKEN_KEY = 'perf_export_token'

const TOKEN_BYTES = 32
// base64url の 32 バイト (パディング無し)
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

const hashOf = (token: string): string => createHash('sha256').update(token).digest('hex')

// 配布スクリプトが揃える鍵の持ち主 (docs/120 §3-2)。実在の利用者名とは
// 重ならない名前にする — 画面からの発行 (issuePerfExportToken) と行を分け、
// どちらかを発行し直してももう片方が使えなくならないように
export const DEPLOY_TOKEN_OWNER = '__deploy__'

export function newPerfExportToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

export function isPerfExportToken(token: string): boolean {
  return TOKEN_PATTERN.test(token)
}

// 手元で作った鍵の hash を登録する (配布スクリプトから。鍵そのものは送らない)
export async function registerPerfExportToken(owner: string, token: string): Promise<void> {
  if (!isPerfExportToken(token)) {
    throw new Error('取得鍵の形が違います')
  }
  await writeUserSetting(owner, PERF_EXPORT_TOKEN_KEY, hashOf(token))
}

// 発行して、鍵そのものを返す (呼び手が 1 度だけ見せる)
export async function issuePerfExportToken(userName: string): Promise<string> {
  const token = newPerfExportToken()
  await registerPerfExportToken(userName, token)
  return token
}

// 鍵の持ち主。形が違う・発行されていない鍵は null
export async function perfExportOwner(token: string): Promise<string | null> {
  if (!isPerfExportToken(token)) {
    return null
  }
  return findUserSettingOwner(PERF_EXPORT_TOKEN_KEY, hashOf(token))
}
