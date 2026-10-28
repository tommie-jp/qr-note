// 計測ログの取得鍵を手元と本番で揃える (docs/120-計測テスト自動化計画.md §3-2)。
//
// doDeploy.sh が配布のたびに SSH トンネル越しに流す。手元の
// ~/.config/qr-note/perf-token が無い (または形が違う) ときは作り直し、
// その sha256 を本番の user_settings (持ち主 __deploy__) に書く。
// **鍵そのものは本番へ送らない** — 送るのは hash だけ。
//
// これで利用者は鍵を受け渡さずに済み、Claude は scripts/fetchPerfLog.sh で
// 本番の計測行を読める。冪等で、毎回流してよい (同じ hash を書き直すだけ)。
//
// 使い方: DATABASE_URL=<本番> npx tsx --conditions=react-server scripts/syncPerfToken.ts
import 'dotenv/config'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { prisma } from '@/lib/db'
import {
  DEPLOY_TOKEN_OWNER,
  isPerfExportToken,
  newPerfExportToken,
  registerPerfExportToken,
} from '@/lib/logging/perfExportToken'

const TOKEN_FILE =
  process.env.QR_PERF_TOKEN_FILE ?? join(homedir(), '.config', 'qr-note', 'perf-token')

function readLocalToken(): string | null {
  if (!existsSync(TOKEN_FILE)) {
    return null
  }
  const token = readFileSync(TOKEN_FILE, 'utf8').trim()
  return isPerfExportToken(token) ? token : null
}

function writeLocalToken(token: string): void {
  mkdirSync(dirname(TOKEN_FILE), { recursive: true, mode: 0o700 })
  writeFileSync(TOKEN_FILE, `${token}\n`, { mode: 0o600 })
  // 既にあったファイルは writeFileSync の mode が効かないので付け直す
  chmodSync(TOKEN_FILE, 0o600)
}

async function main(): Promise<void> {
  let token = readLocalToken()
  if (token === null) {
    token = newPerfExportToken()
    writeLocalToken(token)
    console.log(`取得鍵を作りました: ${TOKEN_FILE}`)
  }
  await registerPerfExportToken(DEPLOY_TOKEN_OWNER, token)
  console.log('取得鍵の hash を本番へ揃えました')
}

main()
  .catch((error: unknown) => {
    console.error('取得鍵を揃えられませんでした', error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
