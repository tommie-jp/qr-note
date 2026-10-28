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

// 発行して、鍵そのものを返す (呼び手が 1 度だけ見せる)
export async function issuePerfExportToken(userName: string): Promise<string> {
  const token = randomBytes(TOKEN_BYTES).toString('base64url')
  await writeUserSetting(userName, PERF_EXPORT_TOKEN_KEY, hashOf(token))
  return token
}

// 鍵の持ち主。形が違う・発行されていない鍵は null
export async function perfExportOwner(token: string): Promise<string | null> {
  if (!TOKEN_PATTERN.test(token)) {
    return null
  }
  return findUserSettingOwner(PERF_EXPORT_TOKEN_KEY, hashOf(token))
}
